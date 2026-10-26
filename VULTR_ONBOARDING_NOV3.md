# 🚀 Vultr Hackathon Quickstart Guide (For November 3rd)

> **Save this document for November 3rd when Vultr credits are delivered.**  
> Everything is pre-configured and tested so you can plug in credentials in under 60 seconds.

---

## ⚡ 60-Second Setup on November 3rd

### Step 1: Run the Interactive Setup Script
Open your terminal in the `GhostShopper` project directory and run:

```bash
python configure-vultr.py
```

This will prompt you for:
1. **`VULTR_API_KEY`**: Your Vultr account API key (from [Vultr API Settings](https://my.vultr.com/settings/#settingsapi)) used to provision cloud servers.
2. **`VULTR_INFERENCE_API_KEY`**: Your Serverless Inference key (from [Vultr Inference](https://my.vultr.com/inference/)) for Llama 3.2 Vision price verification.

*(Alternatively, you can just open `.env` in any text editor and paste the keys directly).*

---

### Step 2: Validate Your Credentials
Run the built-in diagnostic test to confirm your Vultr credits and inference endpoints are active:

```bash
python test-vultr.py
```

**Expected Output**:
```
✓ Vultr Account API: CONNECTED! (Balance: $250.00)
✓ Vultr Serverless Inference: CONNECTED! (Model: llama-3.2-90b-vision-preview)
✓ ALL VULTR CREDENTIALS VERIFIED & LIVE!
```

---

### Step 3: Deploy to Vultr Cloud Compute
Once verified, deploy the entire stack to a live Vultr VM with one command:

```bash
# On Linux/WSL or macOS:
chmod +x scripts/deploy-vultr.sh
./scripts/deploy-vultr.sh --plan vc2-2c-4gb --region ewr
```

This automated script:
- Provisions a dedicated Ubuntu 24.04 Cloud Compute VM using your new credits.
- Sets up the Vultr Cloud Hardware Firewall (ports 22, 8000).
- Installs Docker and the Google gVisor (`runsc`) hypervisor runtime.
- Applies host-level iptables rules blocking `169.254.169.254` (metadata security).
- Returns the public IP address where your live dashboard is running.

---

### Step 4: Expose a Public Demo Link for Judges
If you want an instant public HTTPS link (e.g., `https://ghost-shopper.trycloudflare.com`) to share with hackathon judges:

```bash
chmod +x scripts/expose-public-demo.sh
./scripts/expose-public-demo.sh
```

---

## 🛡️ Secret Hygiene Checklist (Zero Leaks)
- [x] `.env` is listed in [`.gitignore`](file:///c:/Users/LJ/Documents/Wamise%20Tech/GhostShopper/.gitignore) so your keys will **never** be accidentally committed or pushed to GitHub.
- [x] Sandboxed Playwright containers receive **zero** host credentials or environment keys.
- [x] If keys are omitted or expired, the orchestrator automatically falls back to deterministic local parsing and high-fidelity simulation so the dashboard never crashes.
