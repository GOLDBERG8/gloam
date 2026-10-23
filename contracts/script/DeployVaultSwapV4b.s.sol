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
 * vault tokens over the 41 pools below (USDG, GLOAM, WETH, USDe, U, cbBTC,
 * PONS, CASHCAT, VIRTUAL and 20 Robinhood stock tokens), up to three hops, ETH
 * held as WETH.
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
    /// The unverified hook that quotes stale prices: no pool with it is ever allowed.
    address constant BANNED_HOOK = 0x958541C0Ce2E1A158309f7d1b141963eDa31C880;
    /// PoolManager storage slot of its `pools` mapping (v4-core StateLibrary.POOLS_SLOT).
    bytes32 constant POOLS_SLOT = bytes32(uint256(6));

    /// The pools live at deploy, in order: the same list as app/src/lib/vaultSwap.ts
    /// RH_SWAP_POOLS_V2, both pinned by test/fixtures/vault-swap-v2-pools.json. Hookless
    /// pools, GLOAM's launch pool (Orynth hook) and Fables pools (a fee-only hook) as
    /// second routes. Never a pool with the unverified hook 0x958541c0…c880.
    function pools() public pure returns (PoolKey[] memory p) {
        p = new PoolKey[](41);
        p[0] = PoolKey(address(0), 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 500, 10, address(0)); // ETH / USDG 0.05%, hookless
        p[1] = PoolKey(address(0), 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 100, 1, address(0)); // ETH / USDG 0.01%, hookless
        p[2] = PoolKey(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 200, 4, address(0)); // WETH / USDG 0.02%, hookless
        p[3] = PoolKey(address(0), 0xDcD885F5c60b3aD49F6D58718696417314e8724d, 0, 200, 0x953391a2DDf7E8437FeB878FDF2C6f325Fbf00CC); // ETH / GLOAM 0%, Orynth launch hook
        p[4] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xDcD885F5c60b3aD49F6D58718696417314e8724d, 42150, 422, address(0)); // USDG / GLOAM 4.215%, hookless
        p[5] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xDcD885F5c60b3aD49F6D58718696417314e8724d, 24000, 240, address(0)); // USDG / GLOAM 2.4%, hookless
        p[6] = PoolKey(0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 100, 1, address(0)); // USDe / USDG 0.01%, hookless
        p[7] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xcE24439F2D9C6a2289F741120FE202248B666666, 75, 1, address(0)); // USDG / U 0.0075%, hookless
        p[8] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4, 1500, 15, address(0)); // USDG / cbBTC 0.15%, hookless
        p[9] = PoolKey(0x39dBED3a2bd333467115dE45665cC57F813C4571, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 3000, 60, address(0)); // PONS / USDG 0.3%, hookless
        p[10] = PoolKey(0x020bfC650A365f8BB26819deAAbF3E21291018b4, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 2690, 54, address(0)); // CASHCAT / USDG 0.269%, hookless
        p[11] = PoolKey(0x020bfC650A365f8BB26819deAAbF3E21291018b4, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 8388608, 60, 0x08E52564Bad99E05a694b4809F397edcA417A080); // CASHCAT / USDG dynamic fee, Fables fee hook
        p[12] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31, 3000, 60, address(0)); // USDG / VIRTUAL 0.3%, hookless
        p[13] = PoolKey(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 100, 1, address(0)); // SPY / USDG 0.01%, hookless
        p[14] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 100, 1, address(0)); // USDG / NVDA 0.01%, hookless
        p[15] = PoolKey(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 3000, 60, address(0)); // TSLA / USDG 0.3%, hookless
        p[16] = PoolKey(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 8388608, 10, 0x67D86050d22D574Df046F3D90F722045F714e080); // TSLA / USDG dynamic fee, Fables fee hook
        p[17] = PoolKey(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 2400, 24, address(0)); // AMZN / USDG 0.24%, hookless
        p[18] = PoolKey(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 8388608, 60, 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080); // AMZN / USDG dynamic fee, Fables fee hook
        p[19] = PoolKey(address(0), 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 3000, 30, address(0)); // ETH / SPCX 0.3%, hookless
        p[20] = PoolKey(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 8388608, 10, 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080); // SPCX / USDG dynamic fee, Fables fee hook
        p[21] = PoolKey(address(0), 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 1500, 15, address(0)); // ETH / CRCL 0.15%, hookless
        p[22] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 8388608, 60, 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080); // USDG / CRCL dynamic fee, Fables fee hook
        p[23] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 3000, 60, address(0)); // USDG / META 0.3%, hookless
        p[24] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xec262a75e413fAfD0dF80480274532C79D42da09, 2400, 24, address(0)); // USDG / MSTR 0.24%, hookless
        p[25] = PoolKey(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 3000, 60, address(0)); // GOOGL / USDG 0.3%, hookless
        p[26] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 3000, 60, address(0)); // USDG / AAPL 0.3%, hookless
        p[27] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 8388608, 10, 0x70a9A88402989226847Ec122043CE5e7FF462080); // USDG / AAPL dynamic fee, Fables fee hook
        p[28] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xe93237C50D904957Cf27E7B1133b510C669c2e74, 3000, 60, address(0)); // USDG / MSFT 0.3%, hookless
        p[29] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 1500, 15, address(0)); // USDG / PLTR 0.15%, hookless
        p[30] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 10000, 200, address(0)); // USDG / AMD 1%, hookless
        p[31] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 2500, 25, address(0)); // USDG / COIN 0.25%, hookless
        p[32] = PoolKey(0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 500, 5, address(0)); // AMC / USDG 0.05%, hookless
        p[33] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xCceE82fE024c36fA15E1005edE3E9e4787e23D09, 9000, 90, address(0)); // USDG / HIMS 0.9%, hookless
        p[34] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xCceE82fE024c36fA15E1005edE3E9e4787e23D09, 8388608, 60, 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080); // USDG / HIMS dynamic fee, Fables fee hook
        p[35] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 10000, 200, address(0)); // USDG / INTC 1%, hookless
        p[36] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 8388608, 60, 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080); // USDG / INTC dynamic fee, Fables fee hook
        p[37] = PoolKey(0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 7500, 75, address(0)); // TSM / USDG 0.75%, hookless
        p[38] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e, 2100, 21, address(0)); // USDG / GLD 0.21%, hookless
        p[39] = PoolKey(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e, 8388608, 10, 0xB608a78761f179f7C56f15E7D13921B92F00a080); // USDG / GLD dynamic fee, Fables fee hook
        p[40] = PoolKey(address(0), 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 8000, 80, address(0)); // ETH / MU 0.8%, hookless
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
            require(p[i].hooks != BANNED_HOOK, "banned hook");
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
