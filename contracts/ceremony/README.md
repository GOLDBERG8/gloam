# Gloam trusted setup

Gloam's proofs use Groth16, which needs a one-time setup per circuit. Whoever
knows the randomness used in that setup could forge proofs, so we split it
across many people: each contributor mixes in their own randomness and throws it
away. **If even one contributor is honest, nobody can forge a proof.**

Testnet runs on development keys made by one person. Mainnet uses the keys this
ceremony produces.

## What is in scope

Six circuits, the ones mainnet uses:

| Circuit | What it proves |
|---|---|
| `shield` | a deposit's note holds exactly the amount sent |
| `unshield` | a cash out spends a real note to the stated address |
| `transfer` | a private send spends one note into two |
| `solvency` | proof of funds: at least an amount, for a named party |
| `receipt` | proof of payment |
| `payroll_total` | a payroll run's total and count |

Sealed swap is not included. It stays off until its accounting is redesigned.

## How it works

1. **Phase 1** is the public Perpetual Powers of Tau, prepared by Hermez with 54
   contributions and a random beacon:
   - file: `powersOfTau28_hez_final_16.ptau` (up to 64k constraints; our largest
     circuit has about 37k)
   - download: <https://circom.info/powersOfTau28_hez_final_16.ptau> (75,580,568 bytes)
   - blake2b, as published in the [snarkjs README](https://github.com/iden3/snarkjs#7-prepare-phase-2):
     `6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125`
2. **Phase 2** is ours. Round 000 is made from phase 1 with no contribution.
   Each contributor takes the latest round, adds one contribution and hands back
   the next round. Contributions go one at a time, in order.
3. **The beacon.** When contributions close, we apply public randomness that
   nobody could know in advance: a [drand](https://drand.love) round whose number
   we announce before the ceremony closes.
4. **Publish.** Every round, every contribution hash and the final keys are
   public, so anyone can check that their contribution is in the final keys.

## Contributing

Everything a contributor needs, step by step, is in [CONTRIBUTE.md](CONTRIBUTE.md). It takes about 10 minutes, needs Node.js 18 or newer, and needs no wallet or funds. It is written so you can hand it to an AI agent too.

## Checking a round yourself

Anyone can check any round. Put the phase 1 file in `build/` and the six
circuit files from the release in `build/<circuit>/<circuit>.r1cs`, then run:

```bash
node verify.mjs round-005
```

It checks every key against the circuit and phase 1, and lists every
contribution in order, so you can find yours.

## Coordinator

```bash
node coordinator.mjs init                          # once: compile, start round 000
node coordinator.mjs accept <round-folder>         # after each contribution
node coordinator.mjs finalize --beacon <hex> --label "drand round <n>"
```

- `accept` refuses a round that does not come from our round 000 and phase 1, or
  that skips a round, and logs the contributor in `TRANSCRIPT.md`.
- `finalize` applies the beacon, checks the final keys, regenerates the Solidity
  verifiers in `src/verifiers/`, copies the browser files into
  `app/public/circuits/`, and prints the fingerprints for
  `app/src/lib/circuitArtifacts.ts`. Then set `PROVING_CEREMONY` to `"production"`,
  run the tests, and deploy with `PRODUCTION_KEYS=1`.

Round folders and keys are published as release files; they are not committed.
