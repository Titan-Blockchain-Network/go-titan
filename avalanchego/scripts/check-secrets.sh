#!/usr/bin/env bash
# Fail CI if Titan operator key material is committed.
# Upstream avalanchego test fixtures (staking/local, scripts/keys) are excluded.
set -euo pipefail

fail=0

titan_key_paths=(
  docker
  titan-network
  titan-staking
  titan-keys
  config
)

for dir in "${titan_key_paths[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi
  tracked="$(git ls-files "$dir" 2>/dev/null | grep -E '\.(key|pem)$' || true)"
  if [[ -n "$tracked" ]]; then
    echo "ERROR: key files must not be tracked under $dir/:" >&2
    echo "$tracked" >&2
    fail=1
  fi
done

if git grep -n -E 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' -- docker/ titan-network/ titan-staking/ titan-keys/ config/ 2>/dev/null; then
  echo "ERROR: PEM private key material found in Titan operator paths" >&2
  fail=1
fi

exit "$fail"