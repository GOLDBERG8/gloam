# Gloam Contracts

Live on Robinhood Chain mainnet (`4663`) and Tempo mainnet (`4217`) in beta, with `ShieldPoolPayments` on the trusted setup's final keys, and on the testnets (Robinhood Chain `46630`, Tempo `42431`) as the free practice network, on dev keys. The mainnet deploy (`script/DeployRobinhoodMainnet.s.sol`, `script/DeployTempoMainnet.s.sol`) uses the final keys in `src/verifiers/final` and checks them on chain before it creates the pool; see [`PRODUCTION.md`](./PRODUCTION.md). Mainnet is beta software handling real money: reviewed internally (20 October 2026, no Critical or High findings open), external audit planned.

## Do we need contracts?

| Path | Contracts |
| --- | --- |
| Send ETH / ERC-20 | No — native + faucet tokens |
| Public swap (when pools exist) | No — existing DEX router |
| **Shield / private send / private trade / cash out** | **Yes — this package** |

## Live (mainnet, beta)

| Network | Vault `ShieldPoolPayments` | Deploy block | PoseidonT3 |
| --- | --- | --- | --- |
| Robinhood Chain mainnet `4663` | `0x39e28cde55cab798874746ac52cb4b5cc99a0194` | `94194599` | `0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4` |
| Tempo mainnet `4217` | `0x39e28cde55cab798874746ac52cb4b5cc99a0194` | `45172561` | `0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4` |

- Owner and treasury: `0x76b7E410a227c888aBD2Bdc24Ee32E094B0FD4D8` (one wallet at launch; a multisig is planned). Relayer: `0xb1E994586E62994648a0b866BF33F2EDd942512e` (run by the Gloam team; it only submits already-proven transactions and pays gas, and cannot move or redirect money).
- Assets and beta deposit limits (per deposit / total): Robinhood Chain USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (500 / 25,000) and $GLOAM `0xDcD885F5c60b3aD49F6D58718696417314e8724d` (25,000 / 250,000); Tempo USDC.e `0x20c000000000000000000000b9537d11c60e8b50`, pathUSD `0x20c0000000000000000000000000000000000000`, USDT0 `0x20c00000000000000000000014f22ca97301eb73` and OUSD `0x20c0000000000000000000006a37da5c996874be` (500 / 25,000 each). ETH is gas only on Robinhood Chain, not a pool asset.
- Deposits and private transfers are free; `unshield` keeps 0.25% (`withdrawFeeBps = 25`) for the fee recipient. Withdrawals and private transfers are never limited. Raising a limit, listing an asset or raising the fee takes the 3-day timelock; lowering a limit or the fee is instant.
- No payment-memo board on mainnet yet. Verifier addresses: read `verifier()` and `shieldVerifier()` on the pool.

## Testnet (free practice network, dev keys)

| Network | Vault `ShieldPoolPoseidon` | Pay memo board |
| --- | --- | --- |
| Robinhood Chain testnet `46630` | `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740` | `0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE` |
| Tempo Moderato testnet `42431` | `0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb` | `0x3ca88712e9219b5ee4c82d31cafeab64c9e9b4e3` |

Full addresses, verifiers and superseded pools: [deployments/poseidon-testnet.json](./deployments/poseidon-testnet.json) and [ARCHITECTURE.md](./ARCHITECTURE.md).

| Feature | Status |
| --- | --- |
| Shield / unshield / transfer | Live on mainnet (final keys, beta deposit limits, 0.25% cash-out fee) and testnet (dev keys); no admin withdraw, 3-day timelock on rule changes |
| Sealed private trade | Built, switched off on the testnet pools and left out of the mainnet pool (`ShieldPoolPayments`); must not be re-enabled until the H1 and ZK-1 fixes land (see audit/REMEDIATION.md) |
| Pay memos | Live on the testnets; none on mainnet yet |
| Production keys | Done: the 13-contributor ceremony's final keys (drand round 6561386, release `ceremony-final`) in `src/verifiers/final`, used on mainnet |

## Stack

- [Foundry](https://book.getfoundry.sh/) — `forge` / `cast` / `anvil`
- Solidity `0.8.24+`, `evm_version = shanghai` (RH faucet tokens use PUSH0)
- Circom circuits under `circuits/`

## Commands

```bash
cd contracts
forge build
forge test

# Seed vault inventory (need faucet stocks + DEPLOYER_PK)
export DEPLOYER_PK=0x...
export RH_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com
forge script script/SeedVaultInventory.s.sol \
  --rpc-url $RH_TESTNET_RPC --broadcast --gas-estimate-multiplier 200 -vvvv
```

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SEALED_TRADE.md](./SEALED_TRADE.md)
- [PRODUCTION.md](./PRODUCTION.md)
- [AUDIT.md](./AUDIT.md)

## Honesty

- No mock “private success” in the app.
- Public app paths work without this package.
- Dev ceremony zkeys on the testnets only; mainnet runs on the final keys. Never use dev keys for real money.
