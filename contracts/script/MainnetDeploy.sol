// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ShieldPoolPayments} from "../src/ShieldPoolPayments.sol";
import {ShieldVerifier} from "../src/verifiers/ShieldVerifier.sol";
import {ShieldIVerifier} from "../src/verifiers/ShieldIVerifier.sol";
import {UnshieldVerifier} from "../src/verifiers/UnshieldVerifier.sol";
import {UnshieldIVerifier} from "../src/verifiers/UnshieldIVerifier.sol";
import {TransferVerifier} from "../src/verifiers/TransferVerifier.sol";
import {TransferIVerifier} from "../src/verifiers/TransferIVerifier.sol";
import {DualProofVerifier} from "../src/verifiers/DualProofVerifier.sol";

/**
 * The mainnet deploy every chain shares, so Tempo and Robinhood Chain get the
 * same pool wired the same way: the Groth16 verifiers and their adapters, the
 * DualProofVerifier, ShieldPoolPayments (no sealed swap), the shield verifier
 * (deposits need shieldBound()), deposit limits on with each listed asset,
 * an optional handoff to a multisig owner, and endSetup() last.
 *
 * After endSetup the owner can lower a limit at once (lowerDepositLimit, down
 * to 0/0 to close deposits) but raising one or listing a new asset takes the
 * 3-day timelock. Withdrawals and private transfers are never limited.
 *
 * Environment (read by every chain's script):
 *   DEPLOYER_PK          funded deployer
 *   POSEIDON2            PoseidonT3 deployed on this chain (circuits/scripts/deploy-poseidon.mjs)
 *   PRODUCTION_KEYS=1    required: src/verifiers/*.sol regenerated from the ceremony's final zkeys
 *   LIMIT_ASSETS         assets to list, comma separated (0x0 means the chain's native coin, where allowed)
 *   LIMIT_PER_DEPOSIT    per-deposit limit for each, raw units, same order
 *   LIMIT_TOTAL          total limit for each, raw units, same order
 *   NEW_OWNER            optional multisig; it must call acceptOwnership() afterwards
 */
abstract contract MainnetDeploy is Script {
    struct Limits {
        address[] assets;
        uint256[] perDeposit;
        uint256[] total;
    }

    /**
     * @param chainId     the only chain this script may run on
     * @param allowNative whether address(0), the native coin, may be listed
     */
    function _deployMainnet(uint256 chainId, bool allowNative) internal {
        require(block.chainid == chainId, "wrong chain for this script");
        require(
            vm.envOr("PRODUCTION_KEYS", uint256(0)) == 1,
            "set PRODUCTION_KEYS=1 after regenerating verifiers from the ceremony"
        );

        uint256 pk = vm.envUint("DEPLOYER_PK");
        address poseidon2 = vm.envAddress("POSEIDON2");
        require(poseidon2.code.length > 0, "POSEIDON2 has no code on this chain");
        address newOwner = vm.envOr("NEW_OWNER", address(0));
        Limits memory lim = _readLimits(allowNative);

        vm.startBroadcast(pk);
        (address dual, address shieldI) = _deployVerifiers();
        ShieldPoolPayments pool = new ShieldPoolPayments(poseidon2, dual);
        pool.setShieldVerifier(shieldI);
        pool.turnOnDepositLimits();
        for (uint256 i = 0; i < lim.assets.length; i++) {
            pool.setDepositLimit(lim.assets[i], uint128(lim.perDeposit[i]), uint128(lim.total[i]));
        }
        if (newOwner != address(0)) {
            pool.transferOwnership(newOwner);
        }
        // FINAL STEP: end setup mode. Irreversible. Do all wiring ABOVE this line.
        pool.endSetup();
        vm.stopBroadcast();

        _report(pool, poseidon2, dual, shieldI, lim.assets);
    }

    function _readLimits(bool allowNative) internal view returns (Limits memory lim) {
        lim.assets = vm.envAddress("LIMIT_ASSETS", ",");
        lim.perDeposit = vm.envUint("LIMIT_PER_DEPOSIT", ",");
        lim.total = vm.envUint("LIMIT_TOTAL", ",");
        require(lim.assets.length > 0, "LIMIT_ASSETS is empty");
        require(
            lim.assets.length == lim.perDeposit.length && lim.assets.length == lim.total.length,
            "limit lists differ in length"
        );
        for (uint256 i = 0; i < lim.assets.length; i++) {
            if (lim.assets[i] == address(0)) {
                require(allowNative, "this chain has no native coin to list");
            } else {
                require(lim.assets[i].code.length > 0, "listed asset has no code");
            }
            require(lim.perDeposit[i] > 0 && lim.perDeposit[i] <= lim.total[i], "need 0 < perDeposit <= total");
            require(lim.total[i] <= type(uint128).max, "limit too large");
        }
    }

    function _deployVerifiers() internal returns (address dual, address shieldI) {
        ShieldIVerifier s = new ShieldIVerifier(new ShieldVerifier());
        UnshieldIVerifier u = new UnshieldIVerifier(new UnshieldVerifier());
        TransferIVerifier t = new TransferIVerifier(new TransferVerifier());
        dual = address(new DualProofVerifier(u, t));
        shieldI = address(s);
    }

    function _report(
        ShieldPoolPayments pool,
        address poseidon2,
        address dual,
        address shieldI,
        address[] memory assets
    ) internal view {
        console2.log("chainId", block.chainid);
        console2.log("poseidon2", poseidon2);
        console2.log("ShieldPoolPayments", address(pool));
        console2.log("DualProofVerifier", dual);
        console2.log("ShieldIVerifier", shieldI);
        console2.log("depositLimitsOn (must be true)", pool.depositLimitsOn());
        console2.log("setupMode (must be false)", pool.setupMode());
        for (uint256 i = 0; i < assets.length; i++) {
            (uint128 per, uint128 cap) = pool.depositLimit(assets[i]);
            console2.log("listed", assets[i]);
            console2.log("  perDeposit", uint256(per));
            console2.log("  total", uint256(cap));
        }
        if (pool.pendingOwner() != address(0)) {
            console2.log("pendingOwner (must call acceptOwnership)", pool.pendingOwner());
        }
        console2.log("Next: pool + deploy block in app/src/lib/networks.ts");
    }
}
