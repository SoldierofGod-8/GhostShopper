#!/usr/bin/env bash
# =============================================================================
# Ghost Shopper — Vultr Deployment Automation Script
# =============================================================================
# Automates provisioning, configuration, and deployment of the Ghost Shopper
# stack on a Vultr Cloud Compute instance.
#
# Prerequisites:
#   - Vultr API key set as VULTR_API_KEY environment variable
#   - SSH key pair available (~/.ssh/id_rsa.pub)
#   - curl, jq installed locally
#
# Usage:
#   chmod +x scripts/deploy-vultr.sh
#   export VULTR_API_KEY="your_vultr_api_key"
#   ./scripts/deploy-vultr.sh [--plan vc2-2c-4gb] [--region ewr]
# =============================================================================

set -euo pipefail

# ---- Configuration ----
VULTR_API_BASE="https://api.vultr.com/v2"
DEFAULT_PLAN="vc2-2c-4gb"       # 2 vCPUs, 4GB RAM (min for Docker + gVisor)
DEFAULT_REGION="ewr"            # New Jersey (US East)
DEFAULT_OS_ID="2136"            # Ubuntu 24.04 LTS x64
APP_NAME="ghost-shopper"
FIREWALL_GROUP_DESC="Ghost Shopper Security Group"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Parse arguments
PLAN="${DEFAULT_PLAN}"
REGION="${DEFAULT_REGION}"
while [[ $# -gt 0 ]]; do
    case $1 in
        --plan)  PLAN="$2"; shift 2 ;;
        --region) REGION="$2"; shift 2 ;;
        *) log_error "Unknown argument: $1"; exit 1 ;;
    esac
done

# ---- Validate Prerequisites ----
if [ -z "${VULTR_API_KEY:-}" ]; then
    log_error "VULTR_API_KEY environment variable is not set."
    log_error "Get your API key at: https://my.vultr.com/settings/#settingsapi"
    exit 1
fi

for cmd in curl jq; do
    if ! command -v "$cmd" &> /dev/null; then
        log_error "$cmd is required but not installed."
        exit 1
    fi
done

vultr_api() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"

    if [ -n "$data" ]; then
        curl -sS -X "$method" "${VULTR_API_BASE}${endpoint}" \
            -H "Authorization: Bearer ${VULTR_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -sS -X "$method" "${VULTR_API_BASE}${endpoint}" \
            -H "Authorization: Bearer ${VULTR_API_KEY}"
    fi
}

# ---- Step 1: Create Firewall Group ----
log_info "Creating firewall group..."

FW_RESPONSE=$(vultr_api POST "/firewalls" "{\"description\": \"${FIREWALL_GROUP_DESC}\"}")
FW_GROUP_ID=$(echo "$FW_RESPONSE" | jq -r '.firewall_group.id // empty')

if [ -z "$FW_GROUP_ID" ]; then
    log_warn "Could not create firewall group. It may already exist."
    # Try to find existing
    FW_LIST=$(vultr_api GET "/firewalls")
    FW_GROUP_ID=$(echo "$FW_LIST" | jq -r ".firewall_groups[] | select(.description == \"${FIREWALL_GROUP_DESC}\") | .id" | head -1)
fi

if [ -n "$FW_GROUP_ID" ]; then
    log_ok "Firewall group ID: $FW_GROUP_ID"

    # Allow SSH (port 22)
    vultr_api POST "/firewalls/${FW_GROUP_ID}/rules" \
        '{"ip_type":"v4","protocol":"tcp","port":"22","subnet":"0.0.0.0","subnet_size":0,"notes":"SSH Access"}' > /dev/null 2>&1 || true

    # Allow HTTP (port 8000 — Ghost Shopper dashboard)
    vultr_api POST "/firewalls/${FW_GROUP_ID}/rules" \
        '{"ip_type":"v4","protocol":"tcp","port":"8000","subnet":"0.0.0.0","subnet_size":0,"notes":"Ghost Shopper Dashboard"}' > /dev/null 2>&1 || true

    # Allow HTTPS (port 443)
    vultr_api POST "/firewalls/${FW_GROUP_ID}/rules" \
        '{"ip_type":"v4","protocol":"tcp","port":"443","subnet":"0.0.0.0","subnet_size":0,"notes":"HTTPS"}' > /dev/null 2>&1 || true

    log_ok "Firewall rules configured (SSH, HTTP:8000, HTTPS)"
else
    log_warn "Proceeding without firewall group."
    FW_GROUP_ID=""
fi

# ---- Step 2: Upload SSH Key ----
log_info "Checking SSH key..."

SSH_PUB_KEY=""
for key_file in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub; do
    if [ -f "$key_file" ]; then
        SSH_PUB_KEY=$(cat "$key_file")
        break
    fi
done

SSH_KEY_ID=""
if [ -n "$SSH_PUB_KEY" ]; then
    SSH_RESPONSE=$(vultr_api POST "/ssh-keys" \
        "{\"name\": \"ghost-shopper-deploy\", \"ssh_key\": \"${SSH_PUB_KEY}\"}")
    SSH_KEY_ID=$(echo "$SSH_RESPONSE" | jq -r '.ssh_key.id // empty')

    if [ -z "$SSH_KEY_ID" ]; then
        # May already exist, list and find
        SSH_LIST=$(vultr_api GET "/ssh-keys")
        SSH_KEY_ID=$(echo "$SSH_LIST" | jq -r '.ssh_keys[0].id // empty')
    fi

    log_ok "SSH key registered: ${SSH_KEY_ID:-unknown}"
else
    log_warn "No SSH public key found. Instance will use password authentication."
fi

# ---- Step 3: Create Cloud-Init Startup Script ----
log_info "Creating cloud-init startup script..."

STARTUP_SCRIPT=$(cat <<'CLOUD_INIT'
#!/bin/bash
set -euo pipefail

# Update system
apt-get update -y && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | bash

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Install gVisor
curl -fsSL https://storage.googleapis.com/gvisor/releases/release/latest/amd64/runsc -o /usr/local/bin/runsc
curl -fsSL https://storage.googleapis.com/gvisor/releases/release/latest/amd64/containerd-shim-runsc-v1 -o /usr/local/bin/containerd-shim-runsc-v1
chmod +x /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1

# Configure Docker with gVisor runtime
cat > /etc/docker/daemon.json <<'DAEMON'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": ["--network=sandbox", "--platform=systrap"]
    }
  },
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DAEMON

systemctl restart docker

# Install Git and clone project
apt-get install -y git

# Create app directory
mkdir -p /opt/ghost-shopper
cd /opt/ghost-shopper

# Create .env file placeholder
cat > .env <<'ENV'
GHOST_SHOPPER_ENV=production
DOCKER_HOST=unix:///var/run/docker.sock
WARM_POOL_SIZE=3
WARM_POOL_MAX=5
SANDBOX_CPU_LIMIT=1.0
SANDBOX_MEMORY_LIMIT=512m
SANDBOX_TIMEOUT_SECONDS=60
DOCKER_RUNTIME=runsc
VULTR_INFERENCE_API_KEY=CHANGE_ME
VULTR_INFERENCE_ENDPOINT=https://api.vultrinference.com/v1/chat/completions
VULTR_VISION_MODEL=llama-3.2-90b-vision-preview
BLOCKED_SUBNETS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,127.0.0.0/8,100.64.0.0/10
WORKSPACE_DIR=/opt/ghost-shopper/workspace
ENV

echo "=== Ghost Shopper cloud-init ===" > /var/log/ghost-shopper-init.log

# Block the cloud metadata endpoint and all link-local space at the host level
# (defense in depth). Deliberately logged rather than swallowed by '|| true':
# a containment control that fails silently is indistinguishable from one that
# works, which is exactly what we cannot afford in a containment demo.
if iptables -A OUTPUT -d 169.254.0.0/16 -j DROP; then
  echo "EGRESS_BLOCKADE=applied (169.254.0.0/16 OUTPUT DROP)" >> /var/log/ghost-shopper-init.log
else
  echo "EGRESS_BLOCKADE=FAILED - iptables rule NOT applied, containment incomplete" >> /var/log/ghost-shopper-init.log
fi

echo "Ghost Shopper server provisioned successfully" >> /var/log/ghost-shopper-init.log
CLOUD_INIT
)

ENCODED_SCRIPT=$(echo "$STARTUP_SCRIPT" | base64 -w 0)

SCRIPT_RESPONSE=$(vultr_api POST "/startup-scripts" \
    "{\"name\": \"ghost-shopper-init\", \"type\": \"boot\", \"script\": \"${ENCODED_SCRIPT}\"}")
SCRIPT_ID=$(echo "$SCRIPT_RESPONSE" | jq -r '.startup_script.id // empty')

if [ -n "$SCRIPT_ID" ]; then
    log_ok "Startup script created: $SCRIPT_ID"
else
    log_warn "Could not create startup script."
    SCRIPT_ID=""
fi

# ---- Step 4: Deploy Instance ----
log_info "Deploying Vultr instance (plan=$PLAN, region=$REGION)..."

INSTANCE_DATA=$(cat <<INSTANCE
{
    "region": "${REGION}",
    "plan": "${PLAN}",
    "os_id": ${DEFAULT_OS_ID},
    "label": "${APP_NAME}",
    "hostname": "${APP_NAME}",
    "tag": "ghost-shopper",
    "backups": "disabled"
INSTANCE
)

# Add optional fields
if [ -n "$SSH_KEY_ID" ]; then
    INSTANCE_DATA="${INSTANCE_DATA}, \"sshkey_id\": [\"${SSH_KEY_ID}\"]"
fi
if [ -n "$SCRIPT_ID" ]; then
    INSTANCE_DATA="${INSTANCE_DATA}, \"script_id\": \"${SCRIPT_ID}\""
fi
if [ -n "$FW_GROUP_ID" ]; then
    INSTANCE_DATA="${INSTANCE_DATA}, \"firewall_group_id\": \"${FW_GROUP_ID}\""
fi

INSTANCE_DATA="${INSTANCE_DATA} }"

DEPLOY_RESPONSE=$(vultr_api POST "/instances" "$INSTANCE_DATA")
INSTANCE_ID=$(echo "$DEPLOY_RESPONSE" | jq -r '.instance.id // empty')

if [ -z "$INSTANCE_ID" ]; then
    log_error "Failed to create instance:"
    echo "$DEPLOY_RESPONSE" | jq .
    exit 1
fi

log_ok "Instance deployed: $INSTANCE_ID"

# ---- Step 5: Wait for Instance to Boot ----
log_info "Waiting for instance to boot and get IP address..."

for i in $(seq 1 60); do
    INSTANCE_INFO=$(vultr_api GET "/instances/${INSTANCE_ID}")
    INSTANCE_STATUS=$(echo "$INSTANCE_INFO" | jq -r '.instance.status')
    INSTANCE_IP=$(echo "$INSTANCE_INFO" | jq -r '.instance.main_ip')
    INSTANCE_POWER=$(echo "$INSTANCE_INFO" | jq -r '.instance.power_status')

    if [ "$INSTANCE_STATUS" = "active" ] && [ "$INSTANCE_POWER" = "running" ] && [ "$INSTANCE_IP" != "0.0.0.0" ]; then
        break
    fi

    echo -ne "\r  Waiting... (attempt $i/60, status=$INSTANCE_STATUS, power=$INSTANCE_POWER)"
    sleep 5
done

echo ""

if [ "$INSTANCE_IP" = "0.0.0.0" ] || [ -z "$INSTANCE_IP" ]; then
    log_error "Instance did not receive an IP address within timeout."
    exit 1
fi

log_ok "Instance is live at: $INSTANCE_IP"

# ---- Summary ----
INSTANCE_PASSWORD=$(echo "$DEPLOY_RESPONSE" | jq -r '.instance.default_password // "N/A"')

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN} Ghost Shopper Deployment Complete${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  Instance ID:   ${CYAN}${INSTANCE_ID}${NC}"
echo -e "  IP Address:    ${CYAN}${INSTANCE_IP}${NC}"
echo -e "  Plan:          ${PLAN}"
echo -e "  Region:        ${REGION}"
echo -e "  Firewall:      ${FW_GROUP_ID:-none}"
echo ""
echo -e "  ${YELLOW}Default Password: ${INSTANCE_PASSWORD}${NC}"
echo ""
echo -e "  ${CYAN}Next Steps:${NC}"
echo "  1. SSH into the instance:"
echo "     ssh root@${INSTANCE_IP}"
echo ""
echo "  2. Wait for cloud-init to finish (~3-5 min):"
echo "     tail -f /var/log/cloud-init-output.log"
echo ""
echo "  3. Clone your Ghost Shopper project:"
echo "     cd /opt/ghost-shopper"
echo "     # Copy project files or git clone"
echo ""
echo "  4. Configure the .env file with your Vultr Inference API key:"
echo "     nano /opt/ghost-shopper/.env"
echo ""
echo "  5. Build and launch:"
echo "     docker compose build"
echo "     docker compose up -d"
echo ""
echo "  6. Access the dashboard:"
echo "     http://${INSTANCE_IP}:8000"
echo ""
