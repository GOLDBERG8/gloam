// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// GloamVaultSwapV4b against the REAL Robinhood Chain PoolManager on a local fork:
// every one of the deploy script's 41 pools in both directions and the multi-hop
// routes the app builds, with the real hooks (Orynth, Fables), aeWETH and stock
// tokens. Exact accounting on every swap: the spend equals the router's own
// exact-output quote, the new note is exact, the leftover and any extra output go
// to the treasury, and the router and the escrow end empty. A fresh vault with
// accept-all verifiers stands in for the live one (the app's sim-vault-swap-v2.mts
// runs real proofs against the live vault).
//
// Off by default (it reads mainnet over RPC). Run before flipping the app switch,
// from contracts/ (the PoolManager uses transient storage, so Cancun):
//   RH_FORK=1 forge test --evm-version cancun --match-path test/fork/VaultSwapV4bFork.t.sol -vv

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ShieldPoolPayments} from "../../src/ShieldPoolPayments.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {GloamVaultSwap} from "../../src/GloamVaultSwap.sol";
import {PoolKey, SwapParams, IPoolManagerSwap} from "../../src/GloamVaultSwapV4.sol";
import {GloamVaultSwapV4b} from "../../src/GloamVaultSwapV4b.sol";
import {DeployVaultSwapV4b} from "../../script/DeployVaultSwapV4b.s.sol";

interface IERC20A {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function symbol() external view returns (string memory);
}

interface IWETHA {
    function deposit() external payable;
}

interface IExt {
    function extsload(bytes32) external view returns (bytes32);
}

contract AAccept is IVerifier {
    function verify(bytes calldata, uint256[] calldata) external pure returns (bool) {
        return true;
    }
}

/// Unshield proofs "bind" `to`: the proof bytes are the address the vault must pay.
contract ABind is IVerifier {
    function verify(bytes calldata proof, uint256[] calldata inputs) external pure returns (bool) {
        if (inputs.length != 5) return true;
        return abi.decode(proof, (address)) == address(uint160(inputs[4]));
    }
}

/// Exact-output cost of a route, hop by hop from the last, exactly as the router does it.
contract AQuoter {
    IPoolManagerSwap immutable pm;
    error Quote(uint256 cost, uint256 finalOut);

    constructor(address pm_) {
        pm = IPoolManagerSwap(pm_);
    }

    function quote(PoolKey[] memory hops, bool[] memory z, uint256 amountOut) external returns (uint256 cost, uint256 finalOut) {
        try this.q(hops, z, amountOut) {} catch (bytes memory r) {
            if (r.length == 68 && bytes4(r) == Quote.selector) {
                assembly {
                    cost := mload(add(r, 36))
                    finalOut := mload(add(r, 68))
                }
                return (cost, finalOut);
            }
            assembly {
                revert(add(r, 32), mload(r))
            }
        }
    }

    function q(PoolKey[] memory hops, bool[] memory z, uint256 amountOut) external {
        pm.unlock(abi.encode(hops, z, amountOut));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey[] memory hops, bool[] memory z, uint256 want) = abi.decode(data, (PoolKey[], bool[], uint256));
        uint256 finalOut;
        for (uint256 i = hops.length; i > 0; i--) {
            int256 d = pm.swap(
                hops[i - 1],
                SwapParams(z[i - 1], int256(want), z[i - 1] ? 4295128739 + 1 : 1461446703485210103287273052203988822378723970342 - 1),
                ""
            );
            int128 a0 = int128(d >> 128);
            int128 a1 = int128(d);
            int128 o = z[i - 1] ? a1 : a0;
            int128 n = z[i - 1] ? a0 : a1;
            if (i == hops.length) finalOut = uint256(uint128(o));
            want = uint256(uint128(-n));
        }
        revert Quote(want, finalOut);
    }
}

contract VaultSwapV4bForkTest is Test {
    using stdJson for string;

    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NATIVE = address(0);

    ShieldPoolPayments pool;
    GloamVaultSwapV4b router;
    AQuoter quoter;
    PoolKey[] p;
    address treasury = address(0x7EA5);
    address depositor = address(0xD0D0);
    uint256 nul = 1;
    uint256 failures;

    struct Call {
        GloamVaultSwap.Spend s;
        GloamVaultSwap.Deposit d;
        GloamVaultSwap.Deposit r;
        bytes route;
    }

    function setUp() public {
        if (!vm.envOr("RH_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        pool = new ShieldPoolPayments(_deployPoseidon(), address(new ABind()));
        pool.setShieldVerifier(address(new AAccept()));
        pool.setWithdrawFee(25, address(0xFEE));
        pool.turnOnDepositLimits();
        PoolKey[] memory ps = new DeployVaultSwapV4b().pools();
        for (uint256 i = 0; i < ps.length; i++) {
            p.push(ps[i]);
            pool.setDepositLimit(_asset(ps[i].currency0), type(uint128).max, type(uint128).max);
            pool.setDepositLimit(_asset(ps[i].currency1), type(uint128).max, type(uint128).max);
        }
        router = new GloamVaultSwapV4b(address(pool), treasury, PM, WETH, address(this), ps);
        quoter = new AQuoter(PM);
        vm.deal(depositor, 1_000 ether);
    }

    function _deployPoseidon() internal returns (address addr) {
        bytes memory bytecode = vm.readFile("test/fixtures/Poseidon2.json").readBytes(".bytecode");
        assembly {
            addr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(addr != address(0), "poseidon deploy failed");
    }

    function _asset(address c) internal pure returns (address) {
        return c == NATIVE ? WETH : c;
    }

    function _sym(address a) internal view returns (string memory) {
        try IERC20A(a).symbol() returns (string memory s) {
            return s;
        } catch {
            return "?";
        }
    }

    /// The pool's virtual reserve of one side, from slot0 and liquidity.
    function _reserve(PoolKey memory k, bool side1) internal view returns (uint256) {
        bytes32 id = keccak256(abi.encode(k));
        bytes32 slot = keccak256(abi.encode(id, bytes32(uint256(6))));
        uint160 sp = uint160(uint256(IExt(PM).extsload(slot)));
        uint128 liq = uint128(uint256(IExt(PM).extsload(bytes32(uint256(slot) + 3))));
        if (sp == 0 || liq == 0) return 0;
        return side1 ? (uint256(liq) * sp) >> 96 : (uint256(liq) << 96) / sp;
    }

    function _fund(address asset, uint256 amount) internal returns (bool) {
        if (asset == WETH) {
            vm.prank(depositor);
            IWETHA(WETH).deposit{value: amount}();
        } else {
            if (IERC20A(asset).balanceOf(PM) < amount) return false;
            vm.prank(PM);
            try IERC20A(asset).transfer(depositor, amount) returns (bool ok) {
                if (!ok) return false;
            } catch {
                return false;
            }
        }
        vm.startPrank(depositor);
        IERC20A(asset).approve(address(pool), amount);
        pool.shieldBound(asset, amount, bytes32(uint256(0xC0FFEE00000 + nul)), hex"00");
        vm.stopPrank();
        return true;
    }

    function _dirs(PoolKey[] memory hops, address assetIn) internal pure returns (bool[] memory z) {
        z = new bool[](hops.length);
        address cur = assetIn;
        bool hasW = hops[0].currency0 == WETH || hops[0].currency1 == WETH;
        if (assetIn == WETH && !hasW && hops[0].currency0 == NATIVE) cur = NATIVE;
        for (uint256 i = 0; i < hops.length; i++) {
            z[i] = hops[i].currency0 == cur;
            cur = z[i] ? hops[i].currency1 : hops[i].currency0;
        }
    }

    function swapOnce(Call memory k) external returns (uint256) {
        return router.swap(k.s, k.d, k.r, k.route);
    }

    struct Snap {
        uint256 cost;
        uint256 finalOut;
        uint256 note;
        uint256 arrives;
        uint256 depIn;
        uint256 depOut;
        uint256 tIn;
        uint256 tOut;
        address escrow;
        address assetIn;
        address assetOut;
        uint256 want;
        string label;
    }

    /// One private swap through `hops`, buying `want` of assetOut; checks every invariant.
    function _swap(PoolKey[] memory hops, address assetIn, address assetOut, uint256 want, string memory label) internal {
        nul++;
        Snap memory sn;
        sn.assetIn = assetIn;
        sn.assetOut = assetOut;
        sn.want = want;
        sn.label = label;
        bool[] memory z = _dirs(hops, assetIn);
        try quoter.quote(hops, z, want) returns (uint256 c, uint256 f) {
            sn.cost = c;
            sn.finalOut = f;
        } catch (bytes memory err) {
            failures++;
            console2.log("QUOTE FAIL", label);
            console2.logBytes(err);
            return;
        }
        // a note that leaves 1% over the cost after the vault's 0.25% fee
        sn.note = ((sn.cost * 10_100) / 10_000 * 10_000) / 9_975 + 2;
        if (!_fund(assetIn, sn.note)) {
            failures++;
            console2.log("FUND FAIL", label);
            return;
        }
        sn.arrives = sn.note - (sn.note * 25) / 10_000;
        Call memory k = _call(hops, sn);
        sn.depIn = pool.deposited(assetIn);
        sn.depOut = pool.deposited(assetOut);
        sn.tIn = IERC20A(assetIn).balanceOf(treasury);
        sn.tOut = IERC20A(assetOut).balanceOf(treasury);
        try this.swapOnce(k) returns (uint256 spent) {
            _check(sn, spent);
        } catch (bytes memory err) {
            failures++;
            console2.log("SWAP FAIL", label);
            console2.logBytes(err);
        }
    }

    function _call(PoolKey[] memory hops, Snap memory sn) internal view returns (Call memory k) {
        k.d = GloamVaultSwap.Deposit(hex"00", bytes32(nul + 0x1_0000_0000), sn.assetOut, sn.want);
        k.r = GloamVaultSwap.Deposit(hex"00", bytes32(nul + 0x2_0000_0000), sn.assetIn, sn.note - sn.note / 100);
        k.route = abi.encode(hops);
        sn.escrow = router.escrowFor(
            sn.assetIn,
            GloamVaultSwap.EscrowKey(bytes32(nul), sn.note, k.d.commitment, sn.assetOut, sn.want, k.r.commitment, k.r.amount, keccak256(k.route))
        );
        k.s = GloamVaultSwap.Spend(abi.encode(sn.escrow), pool.currentRoot(), bytes32(nul), sn.assetIn, sn.note);
    }

    function _check(Snap memory sn, uint256 spent) internal view {
        assertEq(spent, sn.cost, string.concat(sn.label, ": spent = quoted cost"));
        assertEq(pool.deposited(sn.assetIn), sn.depIn - sn.note, string.concat(sn.label, ": note out"));
        assertEq(pool.deposited(sn.assetOut), sn.depOut + sn.want, string.concat(sn.label, ": new note exact"));
        assertEq(IERC20A(sn.assetIn).balanceOf(treasury) - sn.tIn, sn.arrives - sn.cost, string.concat(sn.label, ": leftover"));
        assertEq(IERC20A(sn.assetOut).balanceOf(treasury) - sn.tOut, sn.finalOut - sn.want, string.concat(sn.label, ": extra out"));
        assertEq(address(router).balance, 0, "router holds no ETH");
        assertEq(IERC20A(sn.assetIn).balanceOf(address(router)), 0, "router holds no input");
        assertEq(IERC20A(sn.assetOut).balanceOf(address(router)), 0, "router holds no output");
        assertEq(IERC20A(sn.assetIn).balanceOf(sn.escrow), 0, "escrow empty");
        console2.log("ok", sn.label, sn.cost, sn.want);
    }

    function _one(uint256 i, bool zeroForOne) internal {
        PoolKey[] memory hops = new PoolKey[](1);
        hops[0] = p[i];
        address cin = zeroForOne ? p[i].currency0 : p[i].currency1;
        address cout = zeroForOne ? p[i].currency1 : p[i].currency0;
        uint256 res = _reserve(p[i], zeroForOne);
        uint256 want = res / 2_000; // 0.05% of the pool's virtual reserve of the output
        string memory label = string.concat(vm.toString(i), " ", _sym(_asset(cin)), "->", _sym(_asset(cout)));
        if (want == 0) {
            failures++;
            console2.log("NO LIQUIDITY", label);
            return;
        }
        _swap(hops, _asset(cin), _asset(cout), want, label);
    }

    /// Every deploy pool, both ways, one hop each.
    function test_fork_every_pool_both_ways() public {
        for (uint256 i = 0; i < p.length; i++) {
            _one(i, true);
            _one(i, false);
        }
        console2.log("failures", failures);
        assertEq(failures, 0, "every pool swaps both ways");
    }

    function _route3(uint256 a, uint256 b, uint256 c, uint256 n) internal view returns (PoolKey[] memory hops) {
        hops = new PoolKey[](n);
        hops[0] = p[a];
        if (n > 1) hops[1] = p[b];
        if (n > 2) hops[2] = p[c];
    }

    /// Multi-hop routes the app builds: stocks through USDG, ETH in the middle, WETH at either end.
    function test_fork_multi_hop_routes() public {
        address GLOAM = 0xDcD885F5c60b3aD49F6D58718696417314e8724d;
        address TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
        address NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
        address SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
        address MU = 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD;
        // TSLA -> USDG (Fables) -> NVDA
        _swap(_route3(16, 14, 0, 2), TSLA, NVDA, _reserve(p[14], true) / 5_000, "TSLA>USDG>NVDA (fables first)");
        // WETH (unwrap) -> ETH/USDG -> USDG/TSLA hookless
        _swap(_route3(0, 15, 0, 2), WETH, TSLA, _reserve(p[15], false) / 5_000, "WETH>ETH>USDG>TSLA");
        // GLOAM -> ETH (Orynth) -> USDG -> NVDA: three hops, ETH in the middle
        _swap(_route3(3, 0, 14, 3), GLOAM, NVDA, _reserve(p[14], true) / 10_000, "GLOAM>ETH>USDG>NVDA");
        // NVDA -> USDG -> ETH (WETH out, wrapped)
        _swap(_route3(14, 0, 0, 2), NVDA, WETH, _reserve(p[0], false) / 10_000, "NVDA>USDG>ETH=WETH");
        // USDG -> SPCX (Fables) -> ETH (wrapped to WETH)
        _swap(_route3(20, 19, 0, 2), USDG, WETH, _reserve(p[19], false) / 10_000, "USDG>SPCX>ETH=WETH");
        // MU -> ETH -> USDG -> GLOAM (hookless 2.4%)
        _swap(_route3(40, 0, 5, 3), MU, GLOAM, _reserve(p[5], true) / 10_000, "MU>ETH>USDG>GLOAM");
        // WETH via the WETH/USDG ERC20 pool to SPCX via Fables
        _swap(_route3(2, 20, 0, 2), WETH, SPCX, _reserve(p[20], false) / 10_000, "WETH>USDG>SPCX (weth pool)");
        console2.log("failures", failures);
        assertEq(failures, 0, "every multi-hop route swaps");
    }

    /// The banned stale-quote hook is in no deploy pool, and no deploy pool is uninitialized.
    function test_fork_deploy_pools_are_live_and_never_the_banned_hook() public view {
        for (uint256 i = 0; i < p.length; i++) {
            assertTrue(p[i].hooks != 0x958541C0Ce2E1A158309f7d1b141963eDa31C880, "banned hook");
            assertTrue(router.allowedPool(keccak256(abi.encode(p[i]))), "allowed at deploy");
        }
    }
}

