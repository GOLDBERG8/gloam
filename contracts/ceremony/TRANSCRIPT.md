# Gloam trusted setup transcript

Phase 1: `powersOfTau28_hez_final_16.ptau` (Perpetual Powers of Tau, Hermez/Polygon), SHA-256 `1c401abb57c9ce531370f3015c3e75c0892e0f32b8b1e94ace0f6682d9695922`.
Compiler: circom compiler 2.1.9. snarkjs 0.7.5.

| Circuit | Constraints | r1cs SHA-256 |
|---|---|---|
| shield | 390 | `80c0fac86e12ebee1a39f40f4b7bf1e8004020d6fb71db340da23eb61db94cca` |
| unshield | 5491 | `92596f1bd6bf1155e96d5243958e69c451f274f9296d4393d2a38f4fa369c2de` |
| transfer | 6270 | `d9b2b3838d1964827067a21bc2bf59c0f6787a85f0e70c678df12dfcbdea2483` |
| solvency | 22244 | `87a7824c9f42d6fb53ca4f1b5e5375dfc523fb1e040d34dd27be8bc8e2634bdf` |
| receipt | 5510 | `37eb1b691c537b39da60175f8a3958288349ec4c5de9f600d6aad5664ca34dba` |
| payroll_total | 37278 | `c54001fdac238039060c6790356cb8d2620ce657477f3450e23585d10b2eaa5a` |

## Beacon

Announced 2026-10-16: drand mainnet round 6578246 (Friday 23 October 2026, 18:00 UTC).

Changed 2026-10-17 at 13:20 UTC, before any contribution: contributors were ready early, so contributions run from 17 October and round 6578246 is withdrawn. The final beacon will be a drand mainnet round (chain `8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce`), announced here after the last contribution is accepted and at least one hour before that round is published, so nobody can know its value when it is chosen. Its randomness is applied to the last accepted round with 2^10 iterations.

## Rounds

- **Round 000** (2026-10-16): initial keys from the public ptau, no contribution.
