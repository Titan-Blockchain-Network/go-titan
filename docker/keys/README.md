# Staking keys (Docker / dev)

Testnet integration keys for `docker-local` and E2E. **Never use on mainnet.**

## Files

| File | Mode | Purpose |
|------|------|---------|
| `staker.crt` | 644 | Staking TLS certificate (public) |
| `staker.key` | 600 | Staking TLS private key |
| `signer.key` | 600 | BLS signer key |

`titan keys generate` writes `.key` files as `0600`. After copying keys in manually:

```sh
chmod 600 staker.key signer.key
chmod 644 staker.crt
```

## Backup and rotation

1. **Backup** — copy the whole directory offline (encrypted volume or hardware backup). Loss of these keys means loss of the genesis validator identity.
2. **Rotation** — do not rotate without updating `initialStakers` in your origin JSON, rebuilding `avalanchego`, and wiping node data directories on all validators.
3. **Git** — never commit `*.key` or `staker.crt` for production keys (`.gitignore` blocks `*.key`; integration fixtures use separate paths under `docker/integration/`).

Treasury / master keys (`~/master.key` or `docker/integration/treasury.key`) follow the same rules: `chmod 600`, offline backup, least-privilege access on the bootstrap node only.