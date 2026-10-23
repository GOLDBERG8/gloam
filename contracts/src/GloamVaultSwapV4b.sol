// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GloamVaultSwap} from "./GloamVaultSwap.sol";
import {PoolKey, SwapParams, IPoolManagerSwap} from "./GloamVaultSwapV4.sol";

/// @notice The canonical wrapped ETH (WETH9, or Arbitrum's aeWETH on Robinhood Chain).
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title GloamVaultSwapV4b
 * @notice Vault swaps on Uniswap v4, second version: any pair of vault assets
 *         joined by allowed pools, up to three hops, and ETH through WETH.
 *         Everything GloamVaultSwap does is unchanged: the escrow key, the
 *         refund note, leftovers to the treasury, the reentrancy latch.
 *
 * ETH. The vault holds WETH, an ERC20, and never sees native ETH. A route may
 * still use pools that hold native ETH: when the note is WETH and the first
 * pool holds ETH (not WETH), the router unwraps exactly what that pool asks
 * and pays it in ETH; when the new note is WETH and the route ends at ETH, the
 * router takes the ETH and wraps all of it. Both follow from the route alone,
 * so the escrow key's route hash fixes them too. Inside a route a currency
 * nets to zero in the PoolManager as before, so a middle ETH never leaves it.
 *
 * Pools. A route may use only pools on the allowlist. The constructor's pools
 * are live at once (the deploy itself is the public notice, as with v1). After
 * that the owner can add a pool only by queueing it: it is usable POOL_DELAY
 * after queueing, and the queue is public (PoolQueued, poolLiveAt). The owner
 * can remove a pool, live or queued, at once. The owner has no other power:
 * no function moves tokens, sets an approval, or changes the vault, the
 * treasury, the PoolManager or WETH, which are all immutable.
 *
 * What a bad pool can do (a hostile hook, or a pool priced against the swap).
 * Each swap names its route in its escrow key, so no pool added later can be
 * slipped into a swap someone already proved. On the routes it is on:
 *  - The new note is always exactly `d.amount` of `d.asset`: its shield proof
 *    binds it, and the swap reverts unless the router holds at least that much
 *    of the output it took.
 *  - The router pays at most what the note brought in (the note's amount less
 *    the vault's fee), and reverts whole above that: the note stays unspent.
 *    So the worst a pool can take is the swap's leftover, the price buffer that
 *    would otherwise go to the treasury. Never another note, never the vault.
 *  - The router gives no approval to any pool, hook or the PoolManager: it pays
 *    by transfer, exactly what the deltas say, and a PoolManager that doesn't
 *    net to zero reverts the whole swap.
 *  - A pool or hook that reverts, or is removed, stops only swaps that route
 *    through it. The refund path never touches a pool, so money sent to an
 *    escrow comes back as the refund note whatever the allowlist says.
 */
contract GloamVaultSwapV4b is GloamVaultSwap {
    IPoolManagerSwap public immutable poolManager;
    /// @notice The WETH the vault holds for ETH.
    address public immutable weth;

    /// @notice How long a queued pool waits before a route may use it.
    uint256 public constant POOL_DELAY = 3 days;
    uint256 public constant MAX_HOPS = 3;
    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;
    address internal constant NATIVE = address(0);

    /// @notice Can queue and remove pools, nothing else.
    address public owner;
    address public pendingOwner;

    /// @notice keccak256(abi.encode(PoolKey)), the v4 PoolId, to the time a route may
    ///         first use it. 0: not on the allowlist.
    mapping(bytes32 => uint256) public poolLiveAt;

    event PoolQueued(
        bytes32 indexed poolId,
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint256 liveAt
    );
    event PoolRemoved(bytes32 indexed poolId);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error BadRoute();
    error BadPool();
    error PoolNotAllowed(bytes32 poolId);
    error PoolListed(bytes32 poolId);
    error PoolNotListed(bytes32 poolId);
    error NotPoolManager();
    error MiddleNotSettled();
    error NotOwner();
    error NotPendingOwner();
    error NativeRefused();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address vault_,
        address treasury_,
        address poolManager_,
        address weth_,
        address owner_,
        PoolKey[] memory pools
    ) GloamVaultSwap(vault_, treasury_) {
        if (poolManager_ == address(0) || weth_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (poolManager_.code.length == 0 || weth_.code.length == 0) revert NotAContract();
        poolManager = IPoolManagerSwap(poolManager_);
        weth = weth_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        for (uint256 i = 0; i < pools.length; i++) {
            _list(pools[i], block.timestamp);
        }
    }

    /// @notice ETH comes in only during a swap, from WETH (an unwrap) or the PoolManager (a take).
    receive() external payable {
        if (!_inSwap() || (msg.sender != weth && msg.sender != address(poolManager))) revert NativeRefused();
    }

    // ───────────────────────────────────────────────────────────── the allowlist

    /// @notice Whether a route may use this pool now.
    function allowedPool(bytes32 poolId) public view returns (bool) {
        uint256 at = poolLiveAt[poolId];
        return at != 0 && block.timestamp >= at;
    }

    /// @notice Put a pool on the allowlist, usable POOL_DELAY from now.
    function queuePool(PoolKey calldata key) external onlyOwner returns (bytes32 poolId) {
        return _list(key, block.timestamp + POOL_DELAY);
    }

    /// @notice Take a pool off the allowlist (or out of the queue) at once.
    function removePool(bytes32 poolId) external onlyOwner {
        if (poolLiveAt[poolId] == 0) revert PoolNotListed(poolId);
        delete poolLiveAt[poolId];
        emit PoolRemoved(poolId);
    }

    function _list(PoolKey memory k, uint256 liveAt) private returns (bytes32 id) {
        // v4 keys hold their currencies sorted, native ETH (address 0) first
        if (k.currency0 >= k.currency1) revert BadPool();
        id = keccak256(abi.encode(k));
        if (poolLiveAt[id] != 0) revert PoolListed(id);
        poolLiveAt[id] = liveAt;
        emit PoolQueued(id, k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks, liveAt);
    }

    // ───────────────────────────────────────────────────────────── owner

    /// @notice Start handing the allowlist to `newOwner`, who must accept it.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    // ───────────────────────────────────────────────────────────── the swap

    /// @dev route = abi.encode(PoolKey[]), pools in order from assetIn to assetOut.
    function _swapExactOut(
        address assetIn,
        address assetOut,
        uint256 amountOut,
        uint256 maxIn,
        bytes calldata route
    ) internal override returns (uint256 amountIn) {
        PoolKey[] memory hops = abi.decode(route, (PoolKey[]));
        if (amountOut > uint256(int256(type(int128).max))) revert InvalidAmount();
        (bool[] memory zeroForOne, address payIn, address takeOut) = _walk(hops, assetIn, assetOut);

        bytes memory res = poolManager.unlock(abi.encode(hops, zeroForOne, payIn, takeOut, amountOut, maxIn));
        amountIn = abi.decode(res, (uint256));

        // ETH that reached the router another way during the swap (a hook's take
        // to it) is wrapped too: the router never keeps ETH, and WETH leaves with
        // the next sweep of WETH, like any token sent here.
        uint256 stray = address(this).balance;
        if (stray != 0) IWETH(weth).deposit{value: stray}();
    }

    /**
     * @dev Checks a route and works out each hop's direction, the currency the
     *      router pays the PoolManager (the note's asset, or ETH for a WETH note
     *      whose first pool holds ETH and not WETH) and the one it takes (the new
     *      note's asset, or ETH for a WETH note whose route ends at ETH).
     */
    function _walk(PoolKey[] memory hops, address assetIn, address assetOut)
        private
        view
        returns (bool[] memory zeroForOne, address payIn, address takeOut)
    {
        uint256 n = hops.length;
        if (n == 0 || n > MAX_HOPS) revert BadRoute();

        // The currencies the route passes through, as the PoolManager sees them.
        address[] memory path = new address[](n + 1);
        zeroForOne = new bool[](n);
        address cur = assetIn;
        if (assetIn == weth && !_holds(hops[0], weth) && _holds(hops[0], NATIVE)) cur = NATIVE;
        path[0] = cur;
        for (uint256 i = 0; i < n; i++) {
            PoolKey memory k = hops[i];
            bytes32 id = keccak256(abi.encode(k));
            if (!allowedPool(id)) revert PoolNotAllowed(id);
            if (k.currency0 == cur) {
                zeroForOne[i] = true;
                cur = k.currency1;
            } else if (k.currency1 == cur) {
                zeroForOne[i] = false;
                cur = k.currency0;
            } else {
                revert BadRoute();
            }
            path[i + 1] = cur;
        }
        if (cur != assetOut && !(assetOut == weth && cur == NATIVE)) revert BadRoute();

        // Each currency once, so the input, the output and every middle currency
        // each have one delta; and WETH, when it is unwrapped or wrapped at an end,
        // is nowhere inside the route. (The vault's assets are never address 0, so
        // ETH at an end always means WETH wrapped or unwrapped there.)
        bool wraps = path[0] == NATIVE || path[n] == NATIVE;
        for (uint256 i = 0; i <= n; i++) {
            if (wraps && path[i] == weth) revert BadRoute();
            for (uint256 j = i + 1; j <= n; j++) {
                if (path[i] == path[j]) revert BadRoute();
            }
        }
        payIn = path[0];
        takeOut = path[n];
    }

    /// @notice Called back by the PoolManager inside unlock(), only during a swap.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_inSwap()) revert NotPoolManager();
        (
            PoolKey[] memory hops,
            bool[] memory zeroForOne,
            address payIn,
            address takeOut,
            uint256 amountOut,
            uint256 maxIn
        ) = abi.decode(data, (PoolKey[], bool[], address, address, uint256, uint256));

        // From the last hop back: buy exactly `want`, then `want` becomes what
        // that hop cost, which the hop before it must buy.
        uint256 want = amountOut;
        uint256 finalOut;
        for (uint256 i = hops.length; i > 0; i--) {
            bool z = zeroForOne[i - 1];
            int256 delta = poolManager.swap(
                hops[i - 1],
                SwapParams({
                    zeroForOne: z,
                    amountSpecified: int256(want),
                    sqrtPriceLimitX96: z ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1
                }),
                ""
            );
            int128 a0 = int128(delta >> 128);
            int128 a1 = int128(delta);
            int128 outD = z ? a1 : a0;
            int128 inD = z ? a0 : a1;
            if (outD < 0 || uint256(uint128(outD)) < want) revert ShortOutput(outD < 0 ? 0 : uint256(uint128(outD)), want);
            // a middle currency must net to exactly zero: no more out than the next hop paid in
            if (i < hops.length && uint256(uint128(outD)) != want) revert MiddleNotSettled();
            if (i == hops.length) finalOut = uint256(uint128(outD));
            if (inD >= 0) revert BadRoute();
            want = uint256(uint128(-inD));
        }
        if (want > maxIn) revert OverInput(want, maxIn);

        // Pay the input: the note's token, or (a WETH note) exactly that much ETH.
        if (payIn == NATIVE) {
            IWETH(weth).withdraw(want);
            poolManager.sync(NATIVE);
            poolManager.settle{value: want}();
        } else {
            poolManager.sync(payIn);
            _transfer(payIn, address(poolManager), want);
            poolManager.settle();
        }
        // Take the whole output; ETH for a WETH note is wrapped, all of it.
        poolManager.take(takeOut, address(this), finalOut);
        if (takeOut == NATIVE) IWETH(weth).deposit{value: finalOut}();
        return abi.encode(want);
    }

    function _holds(PoolKey memory k, address c) private pure returns (bool) {
        return k.currency0 == c || k.currency1 == c;
    }
}
