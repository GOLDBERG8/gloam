// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GloamVaultSwap} from "./GloamVaultSwap.sol";

/// @notice Uniswap v4 PoolKey (Currency and IHooks are addresses).
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @notice Uniswap v4 swap parameters. amountSpecified > 0 is an exact output.
struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

/// @notice The part of Uniswap v4's PoolManager a swap needs.
interface IPoolManagerSwap {
    function unlock(bytes calldata data) external returns (bytes memory);
    /// @return swapDelta BalanceDelta: amount0 in the upper 128 bits, amount1 in the lower, both signed.
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 swapDelta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

/**
 * @title GloamVaultSwapV4
 * @notice Vault swaps on Uniswap v4 (Robinhood Chain). The route is one or two
 *         pools, every one of them on an allowlist fixed at deploy, so a caller
 *         can never send the input through a pool or hook of its own. Exact
 *         output, hop by hop from the last: each hop buys exactly what the
 *         next one needs, so a middle currency (native ETH, say) nets to zero
 *         inside the PoolManager's lock and never touches this contract.
 */
contract GloamVaultSwapV4 is GloamVaultSwap {
    IPoolManagerSwap public immutable poolManager;

    /// @notice Pools a route may use: keccak256(abi.encode(PoolKey)), the v4 PoolId.
    mapping(bytes32 => bool) public allowedPool;

    uint256 public constant MAX_HOPS = 2;
    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;

    event PoolAllowed(bytes32 indexed poolId, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);

    error BadRoute();
    error PoolNotAllowed(bytes32 poolId);
    error NotPoolManager();
    error MiddleNotSettled();

    constructor(address vault_, address treasury_, address poolManager_, PoolKey[] memory pools)
        GloamVaultSwap(vault_, treasury_)
    {
        if (poolManager_ == address(0)) revert ZeroAddress();
        if (poolManager_.code.length == 0) revert NotAContract();
        poolManager = IPoolManagerSwap(poolManager_);
        for (uint256 i = 0; i < pools.length; i++) {
            PoolKey memory k = pools[i];
            bytes32 id = keccak256(abi.encode(k));
            allowedPool[id] = true;
            emit PoolAllowed(id, k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks);
        }
    }

    /// @dev route = abi.encode(PoolKey[]), pools in order from assetIn to assetOut.
    function _swapExactOut(
        address assetIn,
        address assetOut,
        uint256 amountOut,
        uint256 maxIn,
        bytes calldata route
    ) internal override returns (uint256 amountIn) {
        PoolKey[] memory hops = abi.decode(route, (PoolKey[]));
        uint256 n = hops.length;
        if (n == 0 || n > MAX_HOPS) revert BadRoute();
        if (amountOut > uint256(int256(type(int128).max))) revert InvalidAmount();

        bool[] memory zeroForOne = new bool[](n);
        address cur = assetIn;
        for (uint256 i = 0; i < n; i++) {
            PoolKey memory k = hops[i];
            bytes32 id = keccak256(abi.encode(k));
            if (!allowedPool[id]) revert PoolNotAllowed(id);
            if (k.currency0 == cur) {
                zeroForOne[i] = true;
                cur = k.currency1;
            } else if (k.currency1 == cur) {
                zeroForOne[i] = false;
                cur = k.currency0;
            } else {
                revert BadRoute();
            }
        }
        if (cur != assetOut) revert BadRoute();

        bytes memory res = poolManager.unlock(abi.encode(hops, zeroForOne, assetIn, assetOut, amountOut, maxIn));
        amountIn = abi.decode(res, (uint256));
    }

    /// @notice Called back by the PoolManager inside unlock(), only during a swap.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_inSwap()) revert NotPoolManager();
        (
            PoolKey[] memory hops,
            bool[] memory zeroForOne,
            address assetIn,
            address assetOut,
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

        // pay the input, then take the whole output
        poolManager.sync(assetIn);
        _transfer(assetIn, address(poolManager), want);
        poolManager.settle();
        poolManager.take(assetOut, address(this), finalOut);
        return abi.encode(want);
    }
}
