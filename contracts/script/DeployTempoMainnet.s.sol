// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MainnetDeploy} from "./MainnetDeploy.sol";

/**
 * Gloam on Tempo mainnet (chainId 4217): the payments pool with beta deposit
 * limits. The deploy itself is MainnetDeploy, shared with Robinhood Chain.
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
 *   export LIMIT_ASSETS=0xA,0xB         # stablecoins to list (TIP-20 addresses); Tempo has no native coin
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
contract DeployTempoMainnet is MainnetDeploy {
    uint256 constant TEMPO_MAINNET = 4217;

    function run() external {
        _deployMainnet(TEMPO_MAINNET, false);
    }
}
