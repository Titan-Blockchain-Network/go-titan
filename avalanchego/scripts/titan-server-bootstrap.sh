#!/usr/bin/env bash
#
# titan-server-bootstrap.sh
#
# One script to take a fresh Ubuntu server (e.g. DigitalOcean droplet)
# and turn it into a running Titan node (first or additional).
#
# It:
#   - Always starts with apt update + essential packages
#   - Installs Go (from go.mod version) if missing
#   - Installs build deps, ufw, jq, etc.
#   - Builds the titan CLI + avalanchego
#   - Is interactive: asks questions, stops for confirmation
#   - Calls `titan node bootstrap` which does the rest (firewall apply, systemd, healthcheck)
#
# IMPORTANT: This script assumes you have already cloned the repo
# (run after `git clone ... && cd go-titan`). 
# For bare servers with nothing cloned, use the root `install.sh` one-liner instead.
#
# Recommended usage (after you have cloned the repo):
#   git clone https://github.com/Titan-Blockchain-Network/go-titan.git
#   cd go-titan
#   ./avalanchego/scripts/titan-server-bootstrap.sh
#
# For completely bare server (nothing cloned):
#   curl -sSL https://raw.githubusercontent.com/Titan-Blockchain-Network/go-titan/main/install.sh | bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Go up two levels: scripts/ -> avalanchego/ -> repo root
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AVALANCHE_DIR="$REPO_ROOT/avalanchego"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[titan]${NC} $*"; }
warn() { echo -e "${YELLOW}[titan] WARN:${NC} $*"; }
err() { echo -e "${RED}[titan] ERROR:${NC} $*" >&2; }

run_privileged() {
    if [[ $EUID -eq 0 ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

ensure_sudo() {
    if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
        warn "Some steps require sudo. You may be prompted for password."
    fi
}

apt_update_install() {
    log "Starting with apt update (always required for fresh system)..."
    run_privileged apt-get update -y
    log "Installing base dependencies..."
    run_privileged apt-get install -y \
        build-essential \
        git \
        curl \
        wget \
        ca-certificates \
        ufw \
        jq \
        net-tools \
        software-properties-common
}

install_go_if_needed() {
    if command -v go >/dev/null 2>&1; then
        CURRENT_GO=$(go version | awk '{print $3}' | sed 's/go//')
        log "Go already installed: $CURRENT_GO"
        return
    fi

    log "Go not found. Installing from go.mod..."

    GO_VERSION=$(grep '^go ' "$AVALANCHE_DIR/go.mod" 2>/dev/null | awk '{print $2}' || echo "1.24.9")
    log "Target Go version: $GO_VERSION"

    ARCH=$(uname -m)
    case $ARCH in
        x86_64) GOARCH=amd64 ;;
        aarch64) GOARCH=arm64 ;;
        *) err "Unsupported arch: $ARCH"; exit 1 ;;
    esac

    GO_TARBALL="go${GO_VERSION}.linux-${GOARCH}.tar.gz"
    GO_URL="https://go.dev/dl/${GO_TARBALL}"

    cd /tmp
    wget -q --show-progress "$GO_URL" -O "$GO_TARBALL"
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "$GO_TARBALL"
    rm -f "$GO_TARBALL"

    # Make Go available in this shell and for future logins
    export PATH=/usr/local/go/bin:$PATH
    echo 'export PATH=/usr/local/go/bin:$PATH' > /etc/profile.d/go.sh
    chmod +x /etc/profile.d/go.sh

    log "Go $GO_VERSION installed to /usr/local/go"
    go version
}

build_titan_tools() {
    log "Building Titan CLI and avalanchego (this may take a few minutes)..."
    cd "$AVALANCHE_DIR"

    # Use local coreth via replace so relative replace in coreth/go.mod works correctly for avalanchego
    go mod edit -replace github.com/ava-labs/coreth=$REPO_ROOT/coreth

    ./scripts/build-titan.sh
    log "Build complete. Binaries in build/"

    # Automatic binary placement for /usr/local/bin (smooth for systemd)
    if [ -x "build/avalanchego" ]; then
        log "Placing avalanchego binary into /usr/local/bin (for systemd units)..."
        run_privileged mkdir -p /usr/local/bin
        run_privileged cp -f build/avalanchego /usr/local/bin/avalanchego
        run_privileged chmod +x /usr/local/bin/avalanchego
        log "Binary installed to /usr/local/bin/avalanchego"
    fi
}

prompt() {
    local prompt_text="$1"
    local default="${2:-}"
    local var_name="$3"

    if [[ -n "$default" ]]; then
        read -p "$prompt_text [$default]: " input
        input="${input:-$default}"
    else
        read -p "$prompt_text: " input
    fi
    printf -v "$var_name" '%s' "$input"
}

confirm() {
    local msg="$1"
    read -p "$msg [y/N]: " yn
    case $yn in
        [Yy]* ) return 0 ;;
        * ) return 1 ;;
    esac
}

interactive_setup() {
    log "Interactive Titan node bootstrap"

    prompt "Is this the FIRST / genesis validator node? (yes/no)" "no" IS_FIRST
    if [[ "$IS_FIRST" =~ ^(y|Y|yes|YES) ]]; then
        IS_FIRST=true
    else
        IS_FIRST=false
    fi

    prompt "Public IP of this server" "$(curl -s ifconfig.me || echo 'YOUR.IP.HERE')" PUBLIC_IP

    default_keys="/root/keys"
    if $IS_FIRST; then
        default_keys="/root/keys"
        warn "For the first node: if no keys are present, fresh genesis keys will be generated and backed up."
    fi
    prompt "Directory containing staker.crt / staker.key / signer.key (will generate if missing for first node)" "$default_keys" KEYS_DIR

    prompt "Data directory" "/root/titan-data" DATA_DIR
    prompt "Systemd service name" "titan-node" SERVICE_NAME

    APPLY_FIREWALL=true
    if confirm "Apply firewall rules now (recommended: ufw allow SSH + 9651 + 9650)?"; then
        APPLY_FIREWALL=true
    else
        APPLY_FIREWALL=false
    fi

    if ! $IS_FIRST; then
        prompt "Bootstrap IP:port (e.g. 165.22.0.208:9651)" "" BOOTSTRAP_IP
        prompt "Bootstrap NodeID" "" BOOTSTRAP_ID
    fi

    echo
    log "=== Configuration summary ==="
    echo "First node:          $IS_FIRST"
    echo "Public IP:           $PUBLIC_IP"
    echo "Keys dir:            $KEYS_DIR"
    echo "Data dir:            $DATA_DIR"
    echo "Service name:        $SERVICE_NAME"
    echo "Apply firewall:      $APPLY_FIREWALL"
    if ! $IS_FIRST; then
        echo "Bootstrap:           $BOOTSTRAP_IP / $BOOTSTRAP_ID"
    fi
    echo

    if ! confirm "Proceed with this configuration?"; then
        err "Aborted by user."
        exit 1
    fi
}

run_bootstrap() {
    cd "$AVALANCHE_DIR"

    BOOT_ARGS=(
        --public-ip "$PUBLIC_IP"
        --keys-dir "$KEYS_DIR"
        --data-dir "$DATA_DIR"
        --name "$SERVICE_NAME"
    )

    if $IS_FIRST; then
        BOOT_ARGS+=(--first)
    else
        BOOT_ARGS+=(--join "$BOOTSTRAP_IP" --bootstrap-id "$BOOTSTRAP_ID")
    fi

    if $APPLY_FIREWALL; then
        BOOT_ARGS+=(--apply-firewall)
    else
        BOOT_ARGS+=(--apply-firewall=false)
    fi

    log "Running: ./build/titan node bootstrap ${BOOT_ARGS[*]}"
    ./build/titan node bootstrap "${BOOT_ARGS[@]}"
}

main() {
    ensure_sudo

    log "=== Titan Server Bootstrap ==="
    log "This will prepare the system, install dependencies, build, configure firewall, systemd, and run healthcheck."

    apt_update_install
    install_go_if_needed
    build_titan_tools

    interactive_setup

    # Key generation, genesis alignment, rebuild, and data wipe for the first node
    # are handled by: ./build/titan node bootstrap --first
    mkdir -p "$KEYS_DIR"
    if [[ -f "$KEYS_DIR/staker.crt" && -f "$KEYS_DIR/staker.key" && -f "$KEYS_DIR/signer.key" ]]; then
        log "Using pre-existing staking keys in $KEYS_DIR."
    elif $IS_FIRST; then
        log "First node: genesis keys will be generated and aligned during bootstrap."
    else
        log "Join node: fresh staking keys will be generated during bootstrap."
    fi

    # Final confirmation before heavy actions
    if ! confirm "Ready to apply firewall (if selected), systemd, and start the node?"; then
        warn "Setup stopped before applying changes."
        exit 0
    fi

    run_bootstrap

    log "=== Bootstrap finished ==="
    log "Recommended next commands:"
    echo "  ./build/titan status"
    echo "  systemctl status $SERVICE_NAME"
    echo "  journalctl -u $SERVICE_NAME -f"
    echo
    log "For the first node: make sure getCurrentValidators shows your genesis NodeID."
    log "For additional nodes: run 'titan validator add' from a machine that has the funded key."
}

main "$@"
