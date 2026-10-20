// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {UnshieldVerifier} from "./UnshieldVerifier.sol";

/**
 * @title UnshieldIVerifier
 * @notice abi.encode(a,b,c) proof + 5 public inputs → Groth16.
 * @dev For Poseidon pool only. Dev keys (single party): testnet only. Mainnet deploys UnshieldIVerifierFinal (verifiers/final).
 */
contract UnshieldIVerifier is IVerifier {
    UnshieldVerifier public immutable groth16;

    constructor(UnshieldVerifier groth16_) {
        groth16 = groth16_;
    }

    function verify(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 5) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi
            .decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        uint256[5] memory pub;
        for (uint256 i = 0; i < 5; i++) {
            pub[i] = publicInputs[i];
        }
        return groth16.verifyProof(a, b, c, pub);
    }
}
