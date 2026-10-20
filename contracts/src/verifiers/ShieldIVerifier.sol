// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {ShieldVerifier} from "./ShieldVerifier.sol";

/**
 * @title ShieldIVerifier
 * @notice abi.encode(a,b,c) + 3 public inputs [commitment, amount, asset] → Groth16 shield.
 * @dev C1 fix: binds the note commitment to (amount, asset) at deposit so a shield
 *      cannot mint a commitment worth more than the value actually sent. Order MUST match
 *      shield.circom `public [commitment, amount, asset]` and ShieldPoolPoseidon.shieldBound.
 *      Dev keys (single party): testnet only. Mainnet deploys ShieldIVerifierFinal (verifiers/final).
 */
contract ShieldIVerifier is IVerifier {
    ShieldVerifier public immutable groth16;

    constructor(ShieldVerifier groth16_) {
        groth16 = groth16_;
    }

    function verify(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 3) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi
            .decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        uint256[3] memory pub;
        for (uint256 i = 0; i < 3; i++) {
            pub[i] = publicInputs[i];
        }
        return groth16.verifyProof(a, b, c, pub);
    }
}
