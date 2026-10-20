// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {DualProofVerifier} from "../src/verifiers/DualProofVerifier.sol";
import {ShieldVerifier} from "../src/verifiers/ShieldVerifier.sol";
import {ShieldIVerifier} from "../src/verifiers/ShieldIVerifier.sol";
import {UnshieldVerifier} from "../src/verifiers/UnshieldVerifier.sol";
import {UnshieldIVerifier} from "../src/verifiers/UnshieldIVerifier.sol";
import {TransferVerifier} from "../src/verifiers/TransferVerifier.sol";
import {TransferIVerifier} from "../src/verifiers/TransferIVerifier.sol";
import {ShieldVerifierFinal} from "../src/verifiers/final/ShieldVerifierFinal.sol";
import {ShieldIVerifierFinal} from "../src/verifiers/final/ShieldIVerifierFinal.sol";
import {UnshieldVerifierFinal} from "../src/verifiers/final/UnshieldVerifierFinal.sol";
import {UnshieldIVerifierFinal} from "../src/verifiers/final/UnshieldIVerifierFinal.sol";
import {TransferVerifierFinal} from "../src/verifiers/final/TransferVerifierFinal.sol";
import {TransferIVerifierFinal} from "../src/verifiers/final/TransferIVerifierFinal.sol";
import {KeyCheckProofs} from "../script/KeyCheckProofs.sol";

/**
 * Pre-mainnet audit GATE 2: the mainnet verifiers hold the ceremony's final keys,
 * not the single-party dev keys. Each side accepts real proofs made with its own
 * keys and rejects the other side's, so the two key sets can never be confused.
 */
contract KeyCheckTest is Test {
    IVerifier shieldFinal;
    IVerifier dualFinal;
    IVerifier shieldDev;
    IVerifier dualDev;

    function setUp() public {
        shieldFinal = new ShieldIVerifierFinal(new ShieldVerifierFinal());
        dualFinal = new DualProofVerifier(
            new UnshieldIVerifierFinal(new UnshieldVerifierFinal()),
            new TransferIVerifierFinal(new TransferVerifierFinal())
        );
        shieldDev = new ShieldIVerifier(new ShieldVerifier());
        dualDev = new DualProofVerifier(
            new UnshieldIVerifier(new UnshieldVerifier()),
            new TransferIVerifier(new TransferVerifier())
        );
    }

    function _ok(IVerifier v, function() internal pure returns (bytes memory, uint256[] memory) proofOf)
        internal
        view
        returns (bool)
    {
        (bytes memory proof, uint256[] memory pub) = proofOf();
        return v.verify(proof, pub);
    }

    function test_final_verifiers_accept_final_proofs() public view {
        assertTrue(_ok(shieldFinal, KeyCheckProofs.shieldFinal), "shield");
        assertTrue(_ok(dualFinal, KeyCheckProofs.unshieldFinal), "unshield");
        assertTrue(_ok(dualFinal, KeyCheckProofs.transferFinal), "transfer");
    }

    function test_final_verifiers_reject_dev_proofs() public view {
        assertFalse(_ok(shieldFinal, KeyCheckProofs.shieldDev), "shield");
        assertFalse(_ok(dualFinal, KeyCheckProofs.unshieldDev), "unshield");
        assertFalse(_ok(dualFinal, KeyCheckProofs.transferDev), "transfer");
    }

    function test_dev_verifiers_accept_dev_proofs_only() public view {
        assertTrue(_ok(shieldDev, KeyCheckProofs.shieldDev), "shield dev");
        assertTrue(_ok(dualDev, KeyCheckProofs.unshieldDev), "unshield dev");
        assertTrue(_ok(dualDev, KeyCheckProofs.transferDev), "transfer dev");
        assertFalse(_ok(shieldDev, KeyCheckProofs.shieldFinal), "shield final");
        assertFalse(_ok(dualDev, KeyCheckProofs.unshieldFinal), "unshield final");
        assertFalse(_ok(dualDev, KeyCheckProofs.transferFinal), "transfer final");
    }

    function test_a_tampered_final_proof_fails() public view {
        (bytes memory proof, uint256[] memory pub) = KeyCheckProofs.unshieldFinal();
        pub[3] += 1; // one more wei than the note holds
        assertFalse(dualFinal.verify(proof, pub));
    }
}
