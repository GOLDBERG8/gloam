# Gloam Contracts

Live on testnet (Robinhood Chain `46630`, Tempo `42431`) with dev keys. The mainnet deploy (`script/DeployRobinhoodMainnet.s.sol`, `script/DeployTempoMainnet.s.sol`) uses the trusted setup's final keys in `src/verifiers/final` and checks them on chain before it creates the pool; see [`PRODUCTION.md`](./PRODUCTION.md).

## Do we need contracts?

| Path | Contracts |
| --- | --- |
| Send ETH / ERC-20 | No — native + faucet tokens |
| Public swap (when pools exist) | No — existing DEX router |
| **Shield / private send / private trade / cash out** | **Yes — this package** |

## Live (testnet)

| Network | Vault `ShieldPoolPoseidon` | Pay memo board |
| --- | --- | --- |
| Robinhood Chain testnet `46630` | `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740` | `0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE` |
| Tempo Moderato testnet `42431` | `0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb` | `0x3ca88712e9219b5ee4c82d31cafeab64c9e9b4e3` |

Full addresses, verifiers and superseded pools: [deployments/poseidon-testnet.json](./deployments/poseidon-testnet.json) and [ARCHITECTURE.md](./ARCHITECTURE.md).

| Feature | Status |
| --- | --- |
| Shield / unshield / transfer | Live (dev keys), no admin withdraw, 3-day timelock on rule changes |
| Sealed private trade | Built, switched off on-chain; must not be re-enabled until the H1 and ZK-1 fixes land (see audit/REMEDIATION.md) |
| Pay memos | Live |
| Production keys | Not yet: a multi-party ceremony comes before mainnet |

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
- Dev ceremony zkeys only until production gate.
