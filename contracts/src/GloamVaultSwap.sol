// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The vault calls a swap makes. unshield and shieldBound are proof-gated in the vault.
interface IGloamVault {
    function unshield(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        address asset,
        address to,
        uint256 amount
    ) external;

    function shieldBound(address asset, uint256 amount, bytes32 commitment, bytes calldata proof) external payable;

    function isSpent(bytes32 nullifier) external view returns (bool);
}

interface IERC20Swap {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice One swap's drop-off point. The vault pays a swap's input here (the
 *         unshield proof names this address as `to`), and the router deploys
 *         it with CREATE2 in the same transaction: the constructor hands the
 *         whole balance to the router and leaves no code behind.
 */
contract SwapEscrow {
    constructor(address token) {
        uint256 amount = IERC20Swap(token).balanceOf(address(this));
        if (amount != 0) {
            (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, msg.sender, amount));
            require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "escrow transfer");
        }
        assembly {
            return(0, 0)
        }
    }
}

/**
 * @title GloamVaultSwap
 * @notice A private swap through a live Gloam vault, in one transaction:
 *         take one note out of the vault, buy an exact amount of another asset
 *         on a DEX, and put that amount back into the vault as a new note. Who
 *         swapped stays private: the note spent and the note made are both
 *         unlinkable to a wallet, and the Gloam relay submits the call. The
 *         amounts are public, as on any DEX trade.
 *
 * What binds what. The vault's unshield proof has one free public input, `to`.
 * A swap sets it to an escrow address that CREATE2 derives from everything
 * the swap must do: the new note (commitment, asset, amount), a refund note
 * (commitment, amount) and the route. So:
 *  - only the note's owner can start a swap (the proof needs its secret);
 *  - a caller who copies the call and changes the new note, the refund note
 *    or the route gets a different escrow, and the vault rejects the proof;
 *  - the new note's shield proof binds it to exactly `amountOut` of the asset.
 *
 * If someone sends the unshield alone (the proof is public once broadcast),
 * the money waits at the escrow, which only this router can open. The same
 * swap call then sees the note already spent and puts the money back into the
 * vault as the owner's refund note, made beforehand for what is sure to have
 * arrived (the note's amount less the vault's highest possible fee).
 *
 * Holds nothing between transactions: every token this contract has at the
 * end (the unspent input, any extra output, anything sent here by mistake)
 * goes to the immutable treasury, and every approval is set back to zero.
 * No owner, no admin, no upgrade.
 */
abstract contract GloamVaultSwap {
    struct Spend {
        bytes proof;
        bytes32 root;
        bytes32 nullifier;
        address asset;
        uint256 amount;
    }

    struct Deposit {
        bytes proof;
        bytes32 commitment;
        address asset;
        uint256 amount;
    }

    IGloamVault public immutable vault;
    /// @notice Where the leftover input goes: the input the swap did not need.
    address public immutable treasury;

    uint256 private _entered;

    event VaultSwap(
        bytes32 indexed nullifier,
        bytes32 indexed commitment,
        address indexed assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 leftover
    );
    event VaultSwapRefund(bytes32 indexed nullifier, bytes32 indexed commitment, address indexed asset, uint256 amount);

    error ZeroAddress();
    error NotAContract();
    error SameAsset();
    error NativeNotSupported();
    error InvalidAmount();
    error BadRefund();
    error EscrowUsed();
    error OverInput(uint256 needed, uint256 available);
    error ShortOutput(uint256 got, uint256 wanted);
    error Reentrancy();
    error TokenCallFailed();

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address vault_, address treasury_) {
        if (vault_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (vault_.code.length == 0) revert NotAContract();
        vault = IGloamVault(vault_);
        treasury = treasury_;
    }

    /**
     * @notice The address a swap's unshield proof must name as `to`.
     * @param assetIn The note's asset (the escrow hands this token on).
     * @param routeHash keccak256 of the route bytes passed to swap().
     */
    function escrowFor(
        address assetIn,
        bytes32 outCommitment,
        address assetOut,
        uint256 amountOut,
        bytes32 refundCommitment,
        uint256 refundAmount,
        bytes32 routeHash
    ) public view returns (address) {
        return _escrowAt(_salt(outCommitment, assetOut, amountOut, refundCommitment, refundAmount, routeHash), assetIn);
    }

    /**
     * @notice Swap one private note for `d.amount` of `d.asset`, back in the vault.
     *         When the note was already taken out to this swap's escrow by
     *         someone else, puts it back as the refund note `r` instead.
     * @param s The note to spend: its unshield proof names escrowFor(...) as `to`.
     * @param d The note to make: its shield proof binds `d.commitment` to `d.amount` of `d.asset`.
     * @param r The refund note, in `s.asset`, made in advance; used only in that case.
     * @param route Venue-specific route, checked by the venue contract.
     * @return amountIn What the swap spent of the input (0 on a refund).
     */
    function swap(Spend calldata s, Deposit calldata d, Deposit calldata r, bytes calldata route)
        external
        nonReentrant
        returns (uint256 amountIn)
    {
        if (s.asset == d.asset) revert SameAsset();
        if (s.asset == address(0) || d.asset == address(0)) revert NativeNotSupported();
        if (d.amount == 0) revert InvalidAmount();
        if (r.asset != s.asset || r.amount == 0 || r.amount > s.amount || r.commitment == d.commitment) revert BadRefund();

        bool refunding = vault.isSpent(s.nullifier);
        uint256 available = _collect(s, d, r, route, refunding);

        if (refunding) {
            // A note spent some other way leaves its escrow empty: nothing to put back.
            if (available < r.amount) revert BadRefund();
            _deposit(r);
            _sweep(s.asset);
            emit VaultSwapRefund(s.nullifier, r.commitment, r.asset, r.amount);
            return 0;
        }

        uint256 outBefore = _balance(d.asset);
        amountIn = _swapExactOut(s.asset, d.asset, d.amount, available, route);
        if (amountIn > available) revert OverInput(amountIn, available);
        uint256 got = _balance(d.asset) - outBefore;
        if (got < d.amount) revert ShortOutput(got, d.amount);

        _deposit(d);
        uint256 leftover = _sweep(s.asset);
        _sweep(d.asset);
        emit VaultSwap(s.nullifier, d.commitment, s.asset, d.asset, amountIn, d.amount, leftover);
    }

    /// @dev Takes the note out to the swap's escrow (unless that already
    ///      happened), opens the escrow, and returns what arrived here.
    function _collect(Spend calldata s, Deposit calldata d, Deposit calldata r, bytes calldata route, bool spent)
        private
        returns (uint256 available)
    {
        bytes32 salt = _salt(d.commitment, d.asset, d.amount, r.commitment, r.amount, keccak256(route));
        address escrow = _escrowAt(salt, s.asset);
        if (!spent) {
            _unshieldTo(s, escrow);
        } else if (IERC20Swap(s.asset).balanceOf(escrow) < r.amount) {
            // spent some other way, or this swap already ran: nothing waits at the escrow
            revert BadRefund();
        }
        uint256 before = _balance(s.asset);
        _openEscrow(salt, s.asset);
        // the vault keeps its cash-out fee: what arrived is what the swap may spend
        available = _balance(s.asset) - before;
    }

    function _unshieldTo(Spend calldata s, address to) private {
        vault.unshield(s.proof, s.root, s.nullifier, s.asset, to, s.amount);
    }

    function _salt(
        bytes32 outCommitment,
        address assetOut,
        uint256 amountOut,
        bytes32 refundCommitment,
        uint256 refundAmount,
        bytes32 routeHash
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(outCommitment, assetOut, amountOut, refundCommitment, refundAmount, routeHash));
    }

    function _escrowAt(bytes32 salt, address token) private view returns (address) {
        bytes32 codeHash = keccak256(abi.encodePacked(type(SwapEscrow).creationCode, abi.encode(token)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }

    /// @dev Buy exactly `amountOut` of `assetOut` with at most `maxIn` of
    ///      `assetIn` held here, leaving the output here. Returns what it spent.
    function _swapExactOut(
        address assetIn,
        address assetOut,
        uint256 amountOut,
        uint256 maxIn,
        bytes calldata route
    ) internal virtual returns (uint256 amountIn);

    /// @dev True while a swap is running, for venue callbacks.
    function _inSwap() internal view returns (bool) {
        return _entered == 1;
    }

    /// @dev Deploys the swap's escrow, which sends this contract what the vault paid it. Once per swap.
    function _openEscrow(bytes32 salt, address token) private {
        bytes memory code = abi.encodePacked(type(SwapEscrow).creationCode, abi.encode(token));
        address e;
        assembly {
            e := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (e == address(0)) revert EscrowUsed();
    }

    function _deposit(Deposit calldata d) private {
        _approve(d.asset, address(vault), d.amount);
        vault.shieldBound(d.asset, d.amount, d.commitment, d.proof);
        _approve(d.asset, address(vault), 0);
    }

    function _balance(address token) internal view returns (uint256) {
        return IERC20Swap(token).balanceOf(address(this));
    }

    /// @dev Everything held of `token` goes to the treasury. Returns the amount.
    function _sweep(address token) internal returns (uint256 amount) {
        amount = _balance(token);
        if (amount != 0) _transfer(token, treasury, amount);
    }

    function _transfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer(address,uint256)
    }

    function _approve(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0x095ea7b3, spender, amount)); // approve(address,uint256)
    }

    /// @dev A token call that must succeed, for tokens that return true or nothing.
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }
}
