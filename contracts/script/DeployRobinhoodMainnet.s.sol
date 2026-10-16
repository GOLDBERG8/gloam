// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MainnetDeploy} from "./MainnetDeploy.sol";

/**
 * Gloam on Robinhood Chain mainnet (chainId 4663): the payments pool with beta
 * deposit limits. The deploy itself is MainnetDeploy, shared with Tempo, so
 * both chains get the same pool wired the same way.
 *
 * The USER runs this. It is NOT executed by CI or by any agent.
 *
 * Before running:
 *   1. Production keys. src/verifiers/*.sol must be regenerated from the
 *      multi-party ceremony's final zkeys (the repo's are the dev ceremony).
 *      Then set PRODUCTION_KEYS=1; the script refuses to run without it.
 *   2. Deploy Poseidon on mainnet:  node circuits/scripts/deploy-poseidon.mjs
 *
 *   export DEPLOYER_PK=0x...            # funded mainnet deployer (gas is paid in ETH)
 *   export RPC_URL=https://rpc.mainnet.chain.robinhood.com
 *   export POSEIDON2=0x...              # PoseidonT3 from step 2
 *   export PRODUCTION_KEYS=1
 *   # USDG (Paxos Global Dollar, 6 decimals) is 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,
 *   # per docs.paxos.com and checked on-chain. 0x0 lists native ETH (18 decimals).
 *   export LIMIT_ASSETS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
 *   export LIMIT_PER_DEPOSIT=500000000            # raw units (6 decimals: 500 USDG = 500000000)
 *   export LIMIT_TOTAL=25000000000                # raw units (25,000 USDG)
 *   export NEW_OWNER=0x...              # optional: multisig; it must call acceptOwnership()
 *
 * Run (Robinhood Chain is an Arbitrum chain with no special gas cap; the pool
 * is about 10.4 KB of code, well under the 24 KB limit):
 *   forge script script/DeployRobinhoodMainnet.s.sol:DeployRobinhoodMainnet --rpc-url $RPC_URL --broadcast
 *
 * After: record the pool address and deploy block in app/src/lib/networks.ts.
 */
contract DeployRobinhoodMainnet is MainnetDeploy {
    uint256 constant ROBINHOOD_MAINNET = 4663;

    function run() external {
        _deployMainnet(ROBINHOOD_MAINNET, true);
    }
}
