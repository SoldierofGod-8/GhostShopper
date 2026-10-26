#!/usr/bin/env bash
# =============================================================================
# Ghost Shopper — Public Demo URL Generator
# =============================================================================
# Exposes the local or Vultr-hosted Ghost Shopper instance over a secure,
# public HTTPS tunnel so hackathon judges and testers can access it instantly.
#
# Supported tunnel providers:
#   1. Cloudflare Quick Tunnels (Zero configuration, free, recommended)
#   2. ngrok (Requires authtoken)
#   3. Direct IP (If running on a public Vultr Cloud Compute instance)
#
# Usage:
#   chmod +x scripts/expose-public-demo.sh
#   ./scripts/expose-public-demo.sh
# =============================================================================

set -euo pipefail

PORT=8000
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}  🔮 Ghost Shopper — Public Demo URL Exposer        ${NC}"
echo -e "${CYAN}====================================================${NC}"
echo ""

# 1. Verify orchestrator is listening
if ! curl -s "http://localhost:${PORT}/api/health" &> /dev/null; then
    echo -e "${YELLOW}[WARN] Ghost Shopper orchestrator does not appear to be running on port ${PORT}.${NC}"
    echo -e "Starting orchestrator in the background..."
    python3 orchestrator.py &
    sleep 3
fi

# 2. Check for cloudflared
if command -v cloudflared &> /dev/null; then
    echo -e "${GREEN}[OK] cloudflared is installed. Launching Cloudflare Quick Tunnel...${NC}"
    echo -e "${CYAN}Tunneling http://localhost:${PORT} to the public internet...${NC}"
    echo ""
    cloudflared tunnel --url "http://localhost:${PORT}"
    exit 0
fi

# 3. Check for ngrok
if command -v ngrok &> /dev/null; then
    echo -e "${GREEN}[OK] ngrok is installed. Launching ngrok tunnel on port ${PORT}...${NC}"
    echo ""
    ngrok http ${PORT}
    exit 0
fi

# 4. Fallback: Download cloudflared on Linux if available
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "${YELLOW}[INFO] Neither cloudflared nor ngrok found. Installing standalone cloudflared binary...${NC}"
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  CF_ARCH="amd64" ;;
        aarch64) CF_ARCH="arm64" ;;
        *) CF_ARCH="amd64" ;;
    esac

    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    echo -e "${GREEN}[OK] cloudflared downloaded to /tmp/cloudflared.${NC}"
    echo -e "${CYAN}Launching public tunnel...${NC}"
    /tmp/cloudflared tunnel --url "http://localhost:${PORT}"
    exit 0
fi

echo -e "${RED}[ERROR] Neither cloudflared nor ngrok is installed on this system.${NC}"
echo ""
echo "To create a public demo URL, install one of the following:"
echo "  Option A (Recommended): Download Cloudflare Tunnel:"
echo "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
echo ""
echo "  Option B: Install ngrok:"
echo "    https://ngrok.com/download"
echo ""
echo "Alternatively, deploy directly to a Vultr VM using ./scripts/deploy-vultr.sh to get a public IP."
