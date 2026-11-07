#!/usr/bin/env bash
# =============================================================================
# Ghost Shopper — gVisor (runsc) Installation Script
# =============================================================================
# Installs gVisor as an OCI-compliant Docker runtime on Linux (Vultr or local).
# gVisor provides kernel-level syscall filtering through its "Sentry" component,
# creating a virtualized user-space kernel that intercepts all container syscalls.
#
# Usage:
#   chmod +x scripts/setup-gvisor.sh
#   sudo ./scripts/setup-gvisor.sh
#
# Requirements: Linux (Ubuntu 20.04+ / Debian 11+), Docker 20.10+, root privileges
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---- Pre-flight Checks ----
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root (sudo)."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|aarch64)
        # gVisor publishes its release binaries under the raw `uname -m` name
        # (x86_64 / aarch64), NOT the Go-style amd64 / arm64 names. Using the
        # Go names yields HTTP 404 from storage.googleapis.com.
        GVISOR_ARCH="$ARCH"
        ;;
    *)
        log_error "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

log_info "Detected architecture: $ARCH ($GVISOR_ARCH)"

# ---- Download gVisor ----
GVISOR_URL="https://storage.googleapis.com/gvisor/releases/release/latest/${GVISOR_ARCH}"

log_info "Downloading gVisor runsc binary..."
curl -fsSL "${GVISOR_URL}/runsc" -o /usr/local/bin/runsc
curl -fsSL "${GVISOR_URL}/containerd-shim-runsc-v1" -o /usr/local/bin/containerd-shim-runsc-v1

chmod +x /usr/local/bin/runsc
chmod +x /usr/local/bin/containerd-shim-runsc-v1

log_ok "gVisor binaries installed to /usr/local/bin/"

# ---- Verify Installation ----
RUNSC_VERSION=$(/usr/local/bin/runsc --version 2>&1 | head -1 || echo "unknown")
log_info "runsc version: $RUNSC_VERSION"

# ---- Configure Docker Daemon ----
DOCKER_DAEMON_CONFIG="/etc/docker/daemon.json"

log_info "Configuring Docker daemon to register 'runsc' runtime..."

if [ -f "$DOCKER_DAEMON_CONFIG" ]; then
    # Backup existing config
    cp "$DOCKER_DAEMON_CONFIG" "${DOCKER_DAEMON_CONFIG}.backup.$(date +%s)"
    log_info "Backed up existing daemon.json"
fi

# Create or update daemon.json with runsc runtime
python3 -c "
import json, os

config_path = '$DOCKER_DAEMON_CONFIG'
config = {}

if os.path.exists(config_path):
    with open(config_path) as f:
        try:
            config = json.load(f)
        except json.JSONDecodeError:
            pass

if 'runtimes' not in config:
    config['runtimes'] = {}

config['runtimes']['runsc'] = {
    'path': '/usr/local/bin/runsc',
    'runtimeArgs': [
        '--network=sandbox',
        '--platform=systrap'
    ]
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print('Docker daemon.json updated successfully.')
"

# ---- Restart Docker ----
log_info "Restarting Docker daemon..."
systemctl restart docker
sleep 3

if systemctl is-active --quiet docker; then
    log_ok "Docker daemon restarted successfully."
else
    log_error "Docker daemon failed to restart. Check: journalctl -u docker"
    exit 1
fi

# ---- Verification ----
log_info "Verifying gVisor runtime registration..."

if docker info 2>/dev/null | grep -q "runsc"; then
    log_ok "gVisor 'runsc' runtime is registered with Docker."
else
    log_warn "gVisor runtime not detected in 'docker info'. It may still work."
fi

# Test with a simple container
log_info "Running gVisor smoke test (hello-world container)..."
if docker run --rm --runtime=runsc hello-world &> /dev/null; then
    log_ok "gVisor smoke test PASSED. Containers can run with --runtime=runsc"
else
    log_warn "gVisor smoke test failed. This may be due to kernel compatibility."
    log_warn "Check: /usr/local/bin/runsc --version && dmesg | tail"
fi

echo ""
log_ok "============================================"
log_ok " gVisor Installation Complete"
log_ok "============================================"
echo ""
log_info "Runtime: runsc"
log_info "Binary:  /usr/local/bin/runsc"
log_info "Shim:    /usr/local/bin/containerd-shim-runsc-v1"
log_info "Config:  $DOCKER_DAEMON_CONFIG"
echo ""
log_info "Usage: docker run --runtime=runsc <image>"
log_info "Ghost Shopper will automatically use this runtime."
echo ""
