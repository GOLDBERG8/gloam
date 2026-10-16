// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShieldPoolCore} from "./ShieldPoolCore.sol";

/**
 * @title ShieldPoolPayments
 * @notice The mainnet pool: private deposits, transfers and withdrawals, with
 *         beta deposit limits, and no sealed swap. See ShieldPoolCore for the
 *         owner's powers.
 * @dev Sealed swaps stay off until their accounting is redesigned (audit H1,
 *      ZK-1), so this pool leaves that code out entirely. That also keeps the
 *      deploy under Tempo's 30M per-transaction gas cap.
 */
contract ShieldPoolPayments is ShieldPoolCore {
    /**
     * @param poseidon2_ Circomlib Poseidon (2 inputs)
     * @param verifier_ UnshieldIVerifier or address(0) until set
     */
    constructor(address poseidon2_, address verifier_) ShieldPoolCore(poseidon2_, verifier_) {}

    /// @notice Always zero: this pool has no sealed swap. The app reads it the
    ///         same way it reads ShieldPoolPoseidon's to keep trading off.
    function sealedSwapVerifier() external pure returns (address) {
        return address(0);
    }
}
