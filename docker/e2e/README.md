# Four-validator E2E network

Ephemeral provider staking keys are generated under `keys/provider-{1,2,3}/` when you run the E2E script (not committed).

| Node | Role | Host API | Keys |
|------|------|----------|------|
| `bootstrap` | Genesis validator (developer / ATLAS) | `http://127.0.0.1:9650` | `docker/keys/` |
| `provider-1` | Join + onboard | `http://127.0.0.1:19650` | `docker/e2e/keys/provider-1/` |
| `provider-2` | Join + onboard | `http://127.0.0.1:19750` | `docker/e2e/keys/provider-2/` |
| `provider-3` | Join + onboard | `http://127.0.0.1:19850` | `docker/e2e/keys/provider-3/` |

Treasury for onboarding: `docker/integration/treasury.key` (Hardhat dev key #0).