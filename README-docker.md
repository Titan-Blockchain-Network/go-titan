# go-titan / Docker

Docker images for Avalanche L1 nodes. Use Docker Compose for bootstrap (genesis) or provider (join) deployments.

## Compose quickstart

**Bootstrap (first node):**

```sh
./avalanchego/build/titan keys generate --genesis --dir docker/keys
docker compose -f docker/docker-compose.bootstrap.yml up -d
```

**Provider (join node):**

```sh
./avalanchego/build/titan keys generate --dir docker/keys
BOOTSTRAP_IPS=ATLAS_IP:9651 BOOTSTRAP_IDS=NodeID-... \
  docker compose -f docker/docker-compose.provider.yml up -d
```

Set `NODE_MODE=bootstrap` or `NODE_MODE=provider` to auto-configure bootstrap peers.

## Variants
Images with `-dless` postfix are build using distroless base and are rootless.  
Process runs under user `nonroot` with UID `65532`. You should chown your volume mounts to match this UID using `chown -R 65532:65532 /mnt/my/db`.

## Quickstart

```sh
docker run -d \
	-p 9650-9651:9650-9651 \
	flarefoundation/go-flare:<version>
```

**Default network is `titan`.** Mount staking keys at `/app/keys` (`staker.crt`, `staker.key`, `signer.key`). For join nodes, set `BOOTSTRAP_IPS` and `BOOTSTRAP_IDS`, or enable `AUTOCONFIGURE_BOOTSTRAP=1` with `AUTOCONFIGURE_BOOTSTRAP_ENDPOINT` pointing at an existing Titan node's `/ext/info` URL.

## Mounting storage

The three points of interest for mounting are:

| Name | Default location |
|---|:--|
| Database | `/app/db` |
| Logging | `/app/logs` |
| Configuration | `/app/conf` |

<b>All of these may be changed using the environment variables.</b>

```sh
docker run -d \
	-v /tmp/db:/app/db \
	-v /tmp/conf:/app/conf \
	-p 9650:9650 \
	-e AUTOCONFIGURE_BOOTSTRAP=1 \
	flarefoundation/go-flare:latest
```

## Container Configuration

These are the environment variables you can edit and their default values:

| Name | Default | Description |
|:--|:--|:--|
| `HTTP_HOST` | `0.0.0.0` | The bind address of the service |
| `RESTRICT_API` | `0` | Set to `1` to bind HTTP API to `127.0.0.1` only (production bootstrap/provider compose) |
| `HTTP_PORT` | `9650` | The port on which the API is served |
| `STAKING_PORT` | `9651` | The staking port for bootstrapping nodes |
| `PUBLIC_IP` | _(empty)_ | The public IP of the service |
| `DB_DIR` | `/app/db` | The database directory location |
| `DB_TYPE` | `leveldb` | The database type to be used |
| `BOOTSTRAP_IPS` | _(empty)_ | A list of bootstrap server ips; ref [--bootstrap-ips-string](https://docs.avax.network/nodes/maintain/avalanchego-config-flags#--bootstrap-ips-string) |
| `BOOTSTRAP_IDS` | _(empty)_ | A list of bootstrap server ids; ref [--bootstrap-ids-string](https://docs.avax.network/nodes/maintain/avalanchego-config-flags#--bootstrap-ids-string) |
| `CHAIN_CONFIG_DIR` | `/app/conf` | Configuration directory |
| `LOG_DIR` | `/app/logs` | Logging directory |
| `LOG_LEVEL` | `info` | Logging level set with AvalancheGo flag [`--log-level`](https://docs.avax.network/nodes/maintain/avalanchego-config-flags#--log-level-string-verbo-debug-trace-info-warn-error-fatal-off). |
| `NETWORK_ID` | `titan` | Network id (`titan` or `888` for Titan; legacy Flare ids still supported) |
| `STAKING_TLS_CERT_FILE` | `/app/keys/staker.crt` | Staking TLS certificate (determines NodeID) |
| `STAKING_TLS_KEY_FILE` | `/app/keys/staker.key` | Staking TLS private key |
| `STAKING_SIGNER_KEY_FILE` | `/app/keys/signer.key` | BLS signer key |
| `AUTOCONFIGURE_PUBLIC_IP` | `1` | Set to `1` to autoconfigure `PUBLIC_IP`, skipped if PUBLIC_IP is set |
| `AUTOCONFIGURE_BOOTSTRAP` | `0` | Set to `1` to autoconfigure `BOOTSTRAP_IPS` and `BOOTSTRAP_IDS` from a Titan peer |
| `AUTOCONFIGURE_BOOTSTRAP_ENDPOINT` | _(empty)_ | Titan peer API URL (e.g. `http://ATLAS_IP:9650/ext/info`) when autoconfigure is enabled |
| `AUTOCONFIGURE_FALLBACK_ENDPOINTS` | _(empty)_ | Comma-divided fallback bootstrap endpoints, used if `AUTOCONFIGURE_BOOTSTRAP_ENDPOINT` is not valid (not whitelisted / unreachable / etc), tested from first-to-last until one is valid |
| `BOOTSTRAP_BEACON_CONNECTION_TIMEOUT` | `1m` | Set the duration value (eg. `45s` / `5m` / `1h`) for [--bootstrap-beacon-connection-timeout](https://docs.avax.network/nodes/maintain/avalanchego-config-flags#--bootstrap-beacon-connection-timeout-duration) AvalancheGo flag. | 
| `HTTP_ALLOWED_HOSTS` | `*` | Blocks RPC calls unless they originate from these hostnames. | 
| `EXTRA_ARGUMENTS` | | Extra arguments passed to flare binary |


## Node Configuration

The flare node can be configured by specifying your own configuration for the different chains but mainly the C (aka. Contract) chain. The specified configuration determines which capabilities the node has and it affects how the node has to be set up. We mainly distinguish between the three standard configurations described below.

### External API configuration

The external API configuration is set to only respond to API calls so it offloads the other internal nodes. What makes it external is the relatively small set of functions that it exposes which are meant for public use. The node with this configuration exposes the HTTP port (default: 9650) and does not need any publicly open ports to work. The images tagged with the suffix `api` have this configuration preloaded by default.

```sh
{
  "snowman-api-enabled": false,
  "coreth-admin-api-enabled": false,
  "coreth-admin-api-dir": "",
  "eth-apis": [
    "eth",
    "eth-filter",
    "net",
    "web3",
    "internal-eth",
    "internal-blockchain",
    "internal-transaction"
  ],
}
```

### Internal API configuration

Similarly to the external API configuration, this one also responds to API calls but has additional calls exposed that help with longer running tasks, debugging, etc. It is therefore <b>NOT</b> meant for public use and it should <b>NOT</b> be publicly accessible. The node with this configuration exposes the HTTP port (default: 9650) and does not need any publicly open ports to work.

```sh
{
  "snowman-api-enabled": false,
  "coreth-admin-api-enabled": false,
  "coreth-admin-api-dir": "",
  "eth-apis": [
    "eth",
    "eth-filter",
    "admin",
    "debug",
    "net",
    "debug-tracer",
    "web3",
    "internal-eth",
    "internal-blockchain",
    "internal-transaction",
    "internal-tx-pool",
    "internal-debug",
    "internal-account",
    "internal-personal"
  ],
}
```

### Bootstrap configuration

The bootstrap configuration is meant for nodes that will accept and help provision new nodes that want to connect to the network. They need to be publicly accessible and need the staking port (default: 9651) port-forwarded while the http port may remain inaccessible from the public but is needed to initialise the bootstrapping process of a new node.

```sh
{
  "snowman-api-enabled": false,
  "coreth-admin-api-enabled": false,
  "coreth-admin-api-dir": "",
  "eth-apis": [
    "web3"
  ],
}
```

### Additional information

Here's a list of helpful links for additional information about configuration:

* [Chain types and configuration](https://docs.avax.network/nodes/maintain/chain-config-flags)
* [Staking](https://docs.avax.network/nodes/validate/staking)
* [Bootstrapping](https://docs.avax.network/nodes/maintain/avalanchego-config-flags#bootstrapping)
* [API calls](https://docs.avax.network/apis/avalanchego/apis)
