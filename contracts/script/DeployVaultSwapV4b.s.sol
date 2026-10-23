// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "../src/GloamVaultSwapV4.sol";
import {GloamVaultSwapV4b} from "../src/GloamVaultSwapV4b.sol";

interface IPoolManagerState {
    function extsload(bytes32 slot) external view returns (bytes32);
}

interface IWETHMeta {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
}

/**
 * Private swaps v2 on Robinhood Chain mainnet (GloamVaultSwapV4b): any pair of
 * vault tokens over the pools below, up to three hops, ETH held as WETH.
 *
 * The USER runs this. It is NOT executed by CI or by any agent. In zsh, from
 * contracts/ (read -s keeps the key off the screen and out of history):
 *
 *   # 1. a dry run, no key needed: every check runs against live state and the
 *   #    router is deployed only in the local simulation, nothing is sent
 *   forge script script/DeployVaultSwapV4b.s.sol:DeployVaultSwapV4b --sig "dryRun()" \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com
 *   # 2. for real
 *   read -s "DEPLOYER_PK?Deployer key: "; echo; export DEPLOYER_PK
 *   export ROUTER_OWNER=0x...    # optional: who may queue and remove pools (default: the deployer)
 *   forge script script/DeployVaultSwapV4b.s.sol:DeployVaultSwapV4b \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
 *   unset DEPLOYER_PK
 *
 * The key is read from the environment and used only to sign; nothing here
 * prints it. The vault, the treasury, the PoolManager and WETH are fixed for
 * good. The pools below are live at once; any pool added later waits out
 * POOL_DELAY (3 days) after the owner queues it, and the owner can remove one
 * at once.
 *
 * After: the vault must take WETH (a deposit limit, queued on the vault) before
 * swaps into WETH can land. Then put the router address in
 * VAULT_SWAP_V2_ROUTER[4663] (app/src/lib/vaultSwap.ts), the one switch. The
 * pool list there (RH_SWAP_POOLS_V2) is the same as the one below, in order.
 */
contract DeployVaultSwapV4b is Script {
    address constant VAULT = 0x39E28Cde55CAB798874746ac52cb4B5Cc99a0194;
    address constant TREASURY = 0xB3900ac9350903218e4c7597bAb0f008F01B30B8;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    /// Arbitrum's aeWETH behind Robinhood Chain's token bridge: l2Weth() of its
    /// WETH gateway 0x1D187C3E2dA52D72BC9C41e3AbA0fdFa6a7bF055, l1Address() is mainnet WETH9.
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant GLOAM = 0xDcD885F5c60b3aD49F6D58718696417314e8724d;
    address constant ORYNTH_HOOK = 0x953391a2DDf7E8437FeB878FDF2C6f325Fbf00CC;
    /// PoolManager storage slot of its `pools` mapping (v4-core StateLibrary.POOLS_SLOT).
    bytes32 constant POOLS_SLOT = bytes32(uint256(6));

    function pools() public pure returns (PoolKey[] memory p) {
        p = new PoolKey[](7);
        // v1's three
        p[0] = PoolKey(address(0), USDG, 87, 1, address(0)); // ETH / USDG 0.0087% (0x3b0cbf06…)
        p[1] = PoolKey(address(0), GLOAM, 0, 200, ORYNTH_HOOK); // ETH / GLOAM launch pool (0xc5f37371…)
        p[2] = PoolKey(USDG, GLOAM, 42150, 422, address(0)); // USDG / GLOAM 4.215% (0xe5b1e488…)
        // and, hookless
        p[3] = PoolKey(address(0), USDG, 100, 1, address(0)); // ETH / USDG 0.01% (0x24107d15…)
        p[4] = PoolKey(address(0), USDG, 500, 10, address(0)); // ETH / USDG 0.05% (0x387bf619…)
        p[5] = PoolKey(WETH, USDG, 200, 4, address(0)); // WETH / USDG 0.02% (0x84bd4e2d…)
        p[6] = PoolKey(USDG, GLOAM, 24000, 240, address(0)); // USDG / GLOAM 2.4% (0x9200eb96…)
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address owner = vm.envOr("ROUTER_OWNER", vm.addr(pk));
        PoolKey[] memory p = _check();
        vm.startBroadcast(pk);
        GloamVaultSwapV4b router = new GloamVaultSwapV4b(VAULT, TREASURY, POOL_MANAGER, WETH, owner, p);
        vm.stopBroadcast();
        _verify(router, owner, p);
    }

    /// The same checks and deploy, in the local simulation only: no key, nothing broadcast.
    function dryRun() external {
        address owner = vm.envOr("ROUTER_OWNER", msg.sender);
        PoolKey[] memory p = _check();
        GloamVaultSwapV4b router = new GloamVaultSwapV4b(VAULT, TREASURY, POOL_MANAGER, WETH, owner, p);
        _verify(router, owner, p);
        console2.log("dry run only: nothing was sent");
    }

    /// What the router is fixed to, checked against live state before anything is sent.
    function _check() internal view returns (PoolKey[] memory p) {
        require(block.chainid == 4663, "Robinhood Chain mainnet only");
        require(VAULT.code.length > 0 && POOL_MANAGER.code.length > 0, "vault or pool manager missing");
        require(
            keccak256(bytes(IWETHMeta(WETH).symbol())) == keccak256("WETH") && IWETHMeta(WETH).decimals() == 18,
            "not WETH"
        );
        require(WETH.balance >= IWETHMeta(WETH).totalSupply(), "WETH not fully backed");
        p = pools();
        for (uint256 i = 0; i < p.length; i++) {
            bytes32 id = keccak256(abi.encode(p[i]));
            bytes32 slot0 = IPoolManagerState(POOL_MANAGER).extsload(keccak256(abi.encode(id, POOLS_SLOT)));
            require(uint160(uint256(slot0)) != 0, "pool not initialized");
        }
    }

    function _verify(GloamVaultSwapV4b router, address owner, PoolKey[] memory p) internal view {
        require(address(router.vault()) == VAULT && router.treasury() == TREASURY, "wiring");
        require(address(router.poolManager()) == POOL_MANAGER && router.weth() == WETH, "wiring");
        require(router.owner() == owner, "owner");
        for (uint256 i = 0; i < p.length; i++) {
            require(router.allowedPool(keccak256(abi.encode(p[i]))), "pool not allowed");
        }
        console2.log("GloamVaultSwapV4b:", address(router));
        console2.log("owner (queues and removes pools):", owner);
        console2.log("treasury:", TREASURY);
        console2.log("app switch: VAULT_SWAP_V2_ROUTER[4663] in app/src/lib/vaultSwap.ts");
    }
}
