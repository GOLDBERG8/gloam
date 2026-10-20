// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "../../interfaces/IVerifier.sol";
import {UnshieldVerifierFinal} from "./UnshieldVerifierFinal.sol";

/**
 * @title UnshieldIVerifierFinal
 * @notice abi.encode(a,b,c) proof + 5 public inputs → Groth16.
 * @dev For the Poseidon pools.
 *      Same adapter as UnshieldIVerifier, over the ceremony-final keys (mainnet).
 */
contract UnshieldIVerifierFinal is IVerifier {
    UnshieldVerifierFinal public immutable groth16;

    constructor(UnshieldVerifierFinal groth16_) {
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
