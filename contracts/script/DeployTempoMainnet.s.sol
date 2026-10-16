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
 * Gloam on Tempo mainnet (chainId 4217): the payments pool with beta deposit limits.
 *
 * Deploys the Groth16 verifiers, their IVerifier adapters, the DualProofVerifier
 * and ShieldPoolPayments (no sealed swap); turns deposit limits on and lists each
 * asset with its limits; wires the shield verifier so deposits need shieldBound();
 * optionally starts the handoff to a multisig owner; then calls endSetup().
 *
 * After endSetup the owner can lower a limit at once (lowerDepositLimit, down to
 * 0/0 to close deposits) but raising one or listing a new asset takes the 3-day
 * timelock. Withdrawals and private transfers are never limited.
 *
 * The USER runs this. It is NOT executed by CI or by any agent.
 *
 * Before running:
 *   1. Production keys. src/verifiers/*.sol must be regenerated from the
 *      multi-party ceremony's final zkeys (the repo's are the dev ceremony).
 *      Then set PRODUCTION_KEYS=1; the script refuses to run without it.
 *   2. Deploy Poseidon on mainnet:  node circuits/scripts/deploy-poseidon.mjs
 *
 *   export DEPLOYER_PK=0x...            # funded mainnet deployer (gas is paid in USD)
 *   export RPC_URL=https://rpc.tempo.xyz
 *   export POSEIDON2=0x...              # PoseidonT3 from step 2
 *   export PRODUCTION_KEYS=1
 *   export LIMIT_ASSETS=0xA,0xB         # stablecoins to list (TIP-20 addresses)
 *   export LIMIT_PER_DEPOSIT=500000000,500000000      # raw units (6 decimals: 500 = 500000000)
 *   export LIMIT_TOTAL=25000000000,25000000000        # raw units per asset
 *   export NEW_OWNER=0x...              # optional: multisig; it must call acceptOwnership()
 *
 * Run (Tempo caps a tx at 30M gas; the pool estimates ~23.2M, so keep the
 * multiplier at or under 125; forge's default 130 is too high):
 *   forge script script/DeployTempoMainnet.s.sol:DeployTempoMainnet --rpc-url $RPC_URL \
 *     --broadcast --gas-estimate-multiplier 115
 *
 * After: record the pool address and deploy block in app/src/lib/networks.ts.
 */
contract DeployTempoMainnet is Script {
    uint256 constant TEMPO_MAINNET = 4217;

    struct Limits {
        address[] assets;
        uint256[] perDeposit;
        uint256[] total;
    }

    function run() external {
        require(block.chainid == TEMPO_MAINNET, "not Tempo mainnet (4217)");
        require(
            vm.envOr("PRODUCTION_KEYS", uint256(0)) == 1,
            "set PRODUCTION_KEYS=1 after regenerating verifiers from the ceremony"
        );

        uint256 pk = vm.envUint("DEPLOYER_PK");
        address poseidon2 = vm.envAddress("POSEIDON2");
        address newOwner = vm.envOr("NEW_OWNER", address(0));
        Limits memory lim = _readLimits();

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

    function _readLimits() internal view returns (Limits memory lim) {
        lim.assets = vm.envAddress("LIMIT_ASSETS", ",");
        lim.perDeposit = vm.envUint("LIMIT_PER_DEPOSIT", ",");
        lim.total = vm.envUint("LIMIT_TOTAL", ",");
        require(lim.assets.length > 0, "LIMIT_ASSETS is empty");
        require(
            lim.assets.length == lim.perDeposit.length && lim.assets.length == lim.total.length,
            "limit lists differ in length"
        );
        for (uint256 i = 0; i < lim.assets.length; i++) {
            require(lim.assets[i].code.length > 0, "listed asset has no code");
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
