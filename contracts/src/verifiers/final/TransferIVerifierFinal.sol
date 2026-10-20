// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "../../interfaces/IVerifier.sol";
import {TransferVerifierFinal} from "./TransferVerifierFinal.sol";

/**
 * @title TransferIVerifierFinal
 * @notice abi.encode(a,b,c) + 4 public inputs for private transfer.
 * @dev Public: [root, nullifier, newC0, newC1]
 *      Same adapter as TransferIVerifier, over the ceremony-final keys (mainnet).
 */
contract TransferIVerifierFinal is IVerifier {
    TransferVerifierFinal public immutable groth16;

    constructor(TransferVerifierFinal groth16_) {
        groth16 = groth16_;
    }

    function verify(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 4) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi
            .decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        uint256[4] memory pub;
        for (uint256 i = 0; i < 4; i++) {
            pub[i] = publicInputs[i];
        }
        return groth16.verifyProof(a, b, c, pub);
    }
}
