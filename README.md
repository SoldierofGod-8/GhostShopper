# 🔮 Ghost Shopper

**Autonomous E-Commerce Competitor Intelligence System**

> Zero-trust, containerized price intelligence platform that deploys headless browser agents into isolated gVisor sandboxes to safely scrape pricing data from hostile, defensive retail websites.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    GHOST SHOPPER PLATFORM                    │
├──────────────┬──────────────────────┬────────────────────────┤
│  Dashboard   │   FastAPI            │   Vultr Serverless     │
│  (SPA)       │   Orchestrator       │   Inference            │
│              │                      │   (Llama 3.2 Vision)   │
│  ● URL Input │  ● Warm Pool Mgr    │                        │
│  ● Live Logs │  ● Task Runner      │   Tier 2 Verification  │
│  ● Security  │  ● HITL Controller   │   Screenshot Analysis  │
│    Matrix    │  ● Two-Tier Verifier │                        │
├──────────────┴──────────────────────┴────────────────────────┤
│                    Docker + gVisor (runsc)                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  Sandbox 1  │ │  Sandbox 2  │ │  Sandbox N  │  ← Warm    │
│  │  Playwright │ │  Playwright │ │  Playwright │    Pool     │
│  │  Chromium   │ │  Chromium   │ │  Chromium   │  (3-5)     │
│  │  1 vCPU     │ │  1 vCPU     │ │  1 vCPU     │            │
│  │  512MB RAM  │ │  512MB RAM  │ │  512MB RAM  │            │
│  │  No Swap    │ │  No Swap    │ │  No Swap    │            │
│  │  60s Timeout│ │  60s Timeout│ │  60s Timeout│            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

## Features

### 🏗️ Containment-First Architecture ("Blast Radius Zero")
- **gVisor kernel isolation** — Every browser runs inside a `runsc` sandbox with a virtualized user-space kernel
- **Hard resource caps** — 1 vCPU, 512MB RAM, zero swap per container
- **60-second watchdog** — Automatic termination of runaway processes
- **Network blockade** — Private subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) and cloud metadata (169.254.169.254) blocked
- **Capability drops** — ALL Linux capabilities dropped, no-new-privileges enforced
- **Hard purge** — `docker rm -f` wipes all session state, cookies, and memory after each task

### 🔍 Two-Tier Price Verification
1. **Tier 1 (Local)** — Fast regex/heuristic validation catches $0 prices, >90% discounts, missing selectors
2. **Tier 2 (Vision LLM)** — Anomalies route to Vultr Serverless Inference (Llama 3.2 Vision) for screenshot-based visual verification, immune to text-based prompt injection

### 🧊 Human-in-the-Loop Freeze
- Automatic CAPTCHA/bot-challenge detection
- Container CPU frozen via `docker pause` — zero resource consumption while waiting
- Dashboard approval/rejection controls
- Safe `docker unpause` resume on approval

### ⚡ Warm Pool & Concurrency
- Pre-warmed pool of 3–5 idle gVisor containers eliminates cold-start latency
- Concurrent parallel dispatch via `asyncio.gather`
- Automatic pool replenishment every 5 seconds

### 🖥️ Real-Time Dashboard
- Dark cybersecurity aesthetic with neon accents
- Live WebSocket log streaming with level filtering
- Security Observability Matrix (CPU/RAM gauges, network events, container states)
- Screenshot viewport with lightbox inspection
- State pipeline visualization (POOLED → PROVISIONING → EXECUTING → VERIFYING → COMPLETED → WIPED & PURGED)
- Built-in simulation mode for testing without Docker

---

## Quick Start

### Prerequisites
- Python 3.12+
- Docker 20.10+ with Docker Compose
- Node.js 20+ (for sandbox image build)
- gVisor (`runsc`) — [installation script included](#installing-gvisor)

### 1. Clone & Configure

```bash
cd GhostShopper
cp .env.example .env
# Edit .env with your Vultr Inference API key
```

### 2. Install gVisor (Linux only)

```bash
sudo ./scripts/setup-gvisor.sh
```

### 3. Build & Launch

```bash
# Build all images
docker compose build

# Start the orchestrator
docker compose up -d

# View logs
docker compose logs -f orchestrator
```

### 4. Access Dashboard

Open **http://localhost:8000** in your browser.

### Local Development (Without Docker)

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run the orchestrator directly (uses simulation fallback)
python orchestrator.py
# or
uvicorn orchestrator:app --host 0.0.0.0 --port 8000 --reload
```

The orchestrator automatically detects when Docker is unavailable and runs in **simulation mode** — generating realistic mock data for UI development and testing.

---

## File Structure

```
GhostShopper/
├── docker-compose.yml          # System orchestration
├── Dockerfile.sandbox          # Hardened Playwright worker container
├── Dockerfile.orchestrator     # FastAPI orchestrator container
├── .env.example                # Environment variables template
├── .dockerignore               # Docker build exclusions
├── requirements.txt            # Python dependencies
├── package.json                # Node.js sandbox dependencies
├── orchestrator.py             # FastAPI server (central brain)
├── config.py                   # Centralized configuration (pydantic-settings)
├── models.py                   # Pydantic data models & state machine
├── sandbox_manager.py          # Docker container lifecycle manager
├── warm_pool.py                # Pre-warmed container pool manager
├── verifier.py                 # Two-tier verification engine
├── scrape.js                   # Playwright worker (runs in sandbox)
├── frontend/
│   ├── index.html              # Dashboard SPA
│   ├── css/
│   │   └── dashboard.css       # Dark theme styling
│   └── js/
│       ├── app.js              # Main application logic
│       ├── websocket.js        # WebSocket client (auto-reconnect)
│       └── components.js       # UI components (meters, logs, cards)
├── scripts/
│   ├── setup-gvisor.sh         # gVisor installation
│   └── deploy-vultr.sh         # Vultr cloud deployment
└── workspace/                  # Shared output directory
    └── .gitkeep
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scrape` | Submit batch scrape request |
| `GET` | `/api/status/{batch_id}` | Get batch progress & results |
| `GET` | `/api/task/{task_id}` | Get single task details |
| `POST` | `/api/approve/{task_id}` | Approve paused container (HITL) |
| `POST` | `/api/reject/{task_id}` | Reject & purge paused container |
| `GET` | `/api/pool/status` | Warm pool metrics |
| `GET` | `/api/telemetry/{container_id}` | Container resource stats |
| `GET` | `/api/approvals` | List pending HITL requests |
| `GET` | `/api/screenshot/{task_id}` | Serve task screenshot |
| `GET` | `/api/tasks` | List all active tasks |
| `GET` | `/api/health` | System health check |
| `WS` | `/ws/logs` | Real-time event stream |
| `WS` | `/ws` | Real-time event stream (alias) |

### Example: Submit a Batch

```bash
curl -X POST http://localhost:8000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.amazon.com/dp/B0EXAMPLE",
      "https://www.walmart.com/ip/EXAMPLE",
      "https://www.bestbuy.com/site/EXAMPLE"
    ]
  }'
```

Response:
```json
{
  "batch_id": "batch-a1b2c3d4",
  "task_ids": ["task-e5f6g7h8i9", "task-j0k1l2m3n4", "task-o5p6q7r8s9"],
  "status": "submitted",
  "total_urls": 3
}
```

---

## Vultr Deployment

### Automated Deployment

```bash
export VULTR_API_KEY="your_api_key"
./scripts/deploy-vultr.sh --plan vc2-2c-4gb --region ewr
```

This script:
1. Creates a Vultr firewall group (SSH, HTTP:8000, HTTPS)
2. Uploads your SSH key
3. Provisions a cloud instance with Ubuntu 24.04
4. Installs Docker, Docker Compose, and gVisor via cloud-init
5. Blocks metadata endpoint (169.254.169.254) at the host level

### Manual Deployment

1. Create a Vultr Cloud Compute instance (2+ vCPUs, 4+ GB RAM)
2. SSH in and run:
```bash
# Install dependencies
sudo ./scripts/setup-gvisor.sh

# Configure
cp .env.example .env
nano .env  # Set VULTR_INFERENCE_API_KEY

# Launch
docker compose build
docker compose up -d
```

---

## Security Model

### Threat Mitigation Matrix

| Threat | Mitigation |
|--------|------------|
| Browser exploits | gVisor kernel-level syscall filtering |
| Memory leaks / OOM | 512MB hard cap, swap disabled |
| Infinite loops | 60-second watchdog timeout |
| Tracking scripts | Request interception blocks ad/analytics domains |
| Data exfiltration | Private subnet & metadata endpoint blocking |
| Cross-session contamination | `docker rm -f` hard purge after each task |
| Indirect prompt injection | Vision LLM verifies screenshots (not DOM text) |
| Dark patterns / CAPTCHAs | HITL freeze via `docker pause` |
| Privilege escalation | ALL capabilities dropped, no-new-privileges |
| Container escape | gVisor `runsc` provides secondary kernel boundary |

---

## Configuration

All settings are managed via environment variables (`.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `WARM_POOL_SIZE` | `3` | Minimum pre-warmed containers |
| `WARM_POOL_MAX` | `5` | Maximum pool size |
| `SANDBOX_CPU_LIMIT` | `1.0` | vCPU allocation per sandbox |
| `SANDBOX_MEMORY_LIMIT` | `512m` | RAM cap per sandbox |
| `SANDBOX_TIMEOUT_SECONDS` | `60` | Hard execution timeout |
| `DOCKER_RUNTIME` | `runsc` | Container runtime (gVisor) |
| `VULTR_INFERENCE_API_KEY` | — | Vultr Serverless Inference key |
| `VULTR_VISION_MODEL` | `llama-3.2-90b-vision-preview` | Vision LLM model |
| `BLOCKED_SUBNETS` | `10.0.0.0/8,...` | Blocked egress subnets |

---

## License

Proprietary — Wamise Tech. All rights reserved.
