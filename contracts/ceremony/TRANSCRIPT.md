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
- **Round 001** (2026-10-17): Gift
  - shield: `75a45abf4a7579fd6adf82002b15f77ab19d6dbd544d6209164e3f9e46c627aae2f0f8f541441dfd80192afab66e56fbe5b64b9d8b319056a8fbdc5a87a6d0bc`
  - unshield: `eb2fbeaa63bfd22624fb543fdd9a8db710dc22c425bb5deec64899dab64f44215708b66df00250106c3d5a07bcae8165a6209961c6f6c69dd14255a9783afd1d`
  - transfer: `ba19e1d475fe5c5121b583529687e8353c60a356213b073c18dd9c72595f006b40e97657375f5e62798107d2c8fb3f3abb7a50e0b546d628bab11a4e3401587f`
  - solvency: `048da0f5b8f0e2c4d76664f6908209546f9cc9eb231d19423f939808c39612693b0f14d3f4221629f9979ee9ed6ed81a9c825f55879159c36d55d25088391f5d`
  - receipt: `95fa91a46563af698f86dd0b93cea625d258488e1b3f426165381423a0ba0558cfc8ab10899469ec723e5e8c31a4a6c359afd3a0d22d637130ef65e34c17d6d2`
  - payroll_total: `9b76f54f37079384a704ebf670bee5f8c3d0c956f277b7c6581212f4a3c3dad950877e2d1c78066711ac3fd007fc73dc6340697c9d048e0311f0e4e5e76958e9`
