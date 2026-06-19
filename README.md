# go-titan

**go-titan** is an independent Avalanche-style blockchain implementation for the **Titan** network (network ID `888`, token **TITAN**). It is forked from [go-flare](https://github.com/flare-foundation/go-flare), which itself derives from [avalanchego@v1.14.0](https://github.com/ava-labs/avalanchego/releases/tag/v1.14.0) and [coreth@v0.16.0-rc.0](https://github.com/ava-labs/coreth/releases/tag/v0.16.0-rc.0).

## Quick start (Titan)

```sh
git clone https://github.com/Titan-Blockchain-Network/go-titan.git
cd go-titan
./avalanchego/scripts/titan-server-bootstrap.sh
```

See [TITAN_DEPLOY.md](./TITAN_DEPLOY.md) for the full launch guide (genesis node, join nodes, validator registration).

## Flare / Songbird heritage

The codebase retains Flare and Songbird network support from upstream. See [release notes](./RELEASES-flare.md) for Flare-specific changes.

## System Requirements

- go version 1.24
- gcc, g++ and jq
- CPU: Equivalent of 8 AWS vCPU
- RAM: 16 GiB
- Storage: 1TB Flare / 3.5TB Songbird
- OS: Ubuntu 22.04/24.04

## Compilation

After cloning this repository, run:

```sh
cd go-titan/avalanchego && ./scripts/build-titan.sh
```

## Deploy a Validation Node

These servers fulfill a critical role in securing the network:

- They check that all received transactions are valid.
- They run a consensus algorithm so that all validators in the network agree on the transactions to add to the blockchain.
- Finally, they add the agreed-upon transactions to their copy of the ledger.

This guide explains how to deploy your own validator node so you can participate in the consensus and collect the rewards that the network provides to those who help secure it: <https://docs.flare.network/infra/validation/deploying/>

## Deploy an Observation Node

Observation nodes enable anyone to observe the network and submit transactions. Unlike validator nodes, which provide state consensus and add blocks, observation nodes remain outside the network and have no effect on consensus or blocks.

This guide explains how to deploy your own observation node: <https://docs.flare.network/infra/observation/deploying/>

## Tests

See `tests/README.md` for testing details

## Container image (legacy Flare builds)

Public container images are hosted on [Docker HUB](https://hub.docker.com/r/flarefoundation/go-flare) and [Github Packages](https://github.com/orgs/flare-foundation/packages?repo_name=go-flare);

```
docker.io/flarefoundation/go-flare
ghcr.io/flare-foundation/go-flare
```

Images are signed using [Cosign](https://github.com/sigstore/cosign) with the GitHub OIDC provider. To verify the image, run this command:

```bash
cosign verify \
  --certificate-identity-regexp="^https://github\.com/flare-foundation/go-flare/\.github/workflows/build-container\.yml@" \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/flare-foundation/go-flare:<TAG>

cosign verify \
  --certificate-identity-regexp="^https://github\.com/flare-foundation/go-flare/\.github/workflows/build-container\.yml@" \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  docker.io/flarefoundation/go-flare:<TAG>
```

### Container builds in CI

CI builds on each:

- push on `main` branch, pushes image tagged as "dev"
- creation of a tag, pushes images tagged as the tag itself
