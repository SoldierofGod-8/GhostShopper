# 🎬 Ghost Shopper — Recorded Demo Video Script & Storyboard

> **Category**: Pattern B · Sandboxed Browser Use (Comparison Shopper)  
> **Target Audience**: Dropshippers & Owners of AI-Powered E-Commerce Stores (Dynamic Competitor Price Alignment)  
> **Infrastructure**: Vultr Cloud Compute + Vultr Serverless Inference (Vision AI) + gVisor (`runsc`)  
> **Key Showcase**: **"The Containment Moment" (Blast Radius Zero)**  
> **Target Video Length**: 2 minutes 45 seconds (under 3:00)

---

## 📋 Pre-Recording Checklist
1. **Screen Resolution**: Set recording resolution to 1080p (1920x1080) for crisp typography.
2. **Browser Window**: Open Ghost Shopper at `http://localhost:8000` (or your public Vultr URL) in full screen.
3. **Audio Check**: Clear microphone audio, eliminate background noise.
4. **Initial UI State**:
   - Status Bar: Network Link `ONLINE`, Pool Availability `3/3 READY`.
   - Security Matrix: Host CPU ~25%, RAM ~40%, 0 Blocked.
   - Mode Tab: **🎯 Pattern B: Goal Planner** selected.

---

## ⏱️ Video Storyboard & Script

### Scene 1: Introduction & The Core Problem (0:00 – 0:30)
- **Visual**: Show the Ghost Shopper Dashboard full-screen. Neon cybersecurity aesthetic, live meters pulsing gently.
- **Voiceover**:
  > *"Hi everyone, this is **Ghost Shopper** — an autonomous competitor price intelligence system built specifically for **dropshippers and AI-powered dropshipping stores** to dynamically align retail prices and protect store margins under a strict **'Blast Radius Zero'** architecture on Vultr infrastructure.*
  >
  > *In dropshipping, your survival depends on competitive pricing against giants like Amazon, Walmart, and rival stores. But scraping competitor prices is hazardous: hostile anti-bot scripts, IP blacklists that can take down your store, and deceptive fake prices in HTML microdata.*
  >
  > *Ghost Shopper solves this by using Vultr as a centralized mission control that dispatches browser agents into disposable gVisor sandboxes where untrusted competitor websites can never escape or harm your infrastructure."*

---

### Scene 2: Pattern B — Goal-Oriented Agent Planning (0:30 – 1:10)
- **Visual**: Click on the **🎧 Sony XM5** quick-goal button. The goal text loads into the textarea:
  `Compare Sony WH-1000XM5 wireless noise-canceling headphones across competitor retail sites, audit true checkout prices with Vultr Vision AI, and align dropshipping store margins against hidden fees.`
- **Action**: Click the glowing blue **[Plan & Dispatch Agent Fleet]** button.
- **Visual**:
  - Live log stream starts scrolling rapidly.
  - Show the log entries highlighting:
    - `[AGENT PLANNER] Goal received: Deconstructed into 3 competitor trajectories.`
    - `[AGENT PLANNER] Acquired pre-warmed gVisor microVMs from warm pool.`
    - `[LAUNCH] Chromium initialized with hardened flags [--no-sandbox --disable-gpu].`
  - In the **Mission Viewport**, sandbox snapshot cards appear with live status badges (`EXECUTING`).
  - The **Lifecycle State Pipeline** advances: `POOLED` ➔ `PROVISIONING` ➔ `EXECUTING`.
- **Voiceover**:
  > *"Here's Pattern B in action. As a dropshipper auditing a top-selling product, we input a high-level goal. The orchestrator plans the mission, acquires pre-warmed gVisor microVMs from our pool to eliminate cold-start delay, and dispatches headless Playwright agents in parallel.*
  >
  > *Crucially: notice our Secret Hygiene. The sandbox environment receives zero API keys, no store credentials, and runs with dropped capabilities. It cannot access anything on our host Vultr VM."*

---

### Scene 3: THE CONTAINMENT MOMENT (1:10 – 2:05) — *Key Rubric Requirement*
- **Visual**: Point the cursor to the red **🛡️ VULTR DEMO VIDEO: CONTAINMENT MOMENTS** section.
- **Action**: Click **[🔒 Block Cloud SSRF (169.254)]** or **[🛑 Deceptive Price & HITL Freeze]**.
- **Visual**:
  - **SSRF Blockade Demo**:
    - Live Log flashes with a red warning:
      `[SECURITY BLOCKADE] Target script attempted outbound call to 169.254.169.254:80 (Vultr Metadata Service).`
      `[BLAST RADIUS ZERO] Syscall intercepted by gVisor Sentry. Egress rule dropped connection.`
    - The **Egress Firewall Counter** ticks up to `1 Blocked`.
    - Host CPU and host memory remain completely flat.
  - **Human-in-the-Loop Freeze (`docker pause`)**:
    - The top alert card flashes orange: **"Human-in-the-Loop Intervention Required"**.
    - Live Log displays:
      `[TIER 1 ANOMALY] DOM parser reports: '$0.00' (Free Item).`
      `[VULTR VISION LLM] Vision screenshot audit: 'Visual page shows $249.99 with $50 hidden checkout fee. Prompt injection suspected.'`
      `[HITL FREEZE] Executed 'docker pause'. Container CPU ticks frozen at 0.00%.`
- **Voiceover**:
  > *"Now, here is our **Containment Moment**. On an untrusted competitor site, a rogue script attempts Server-Side Request Forgery against the Vultr Cloud Metadata endpoint at 169.254.169.254 to exfiltrate infrastructure keys.*
  >
  > *Instantly, our gVisor user-space kernel (runsc) and egress firewall intercept the syscall and drop the packet. Notice our host system is completely untouched.*
  >
  > *At the same time, the competitor attempts a deceptive pricing trick with a fake $0 DOM price to mislead scrapers. In dropshipping, undercutting a phantom price means losing money on every order. Our Two-Tier Verifier routes the visual screenshot to Vultr Serverless Inference running Vision AI. The model sees through the DOM injection and detects the hidden $50 fee.*
  >
  > *The orchestrator immediately issues a `docker pause` — freezing CPU execution cycles to zero while keeping the memory state preserved for human review."*

---

### Scene 4: Operator Action & The Hard Purge (2:05 – 2:30)
- **Visual**: 
  - Show the Human-in-the-Loop review card. 
  - Click **[Authorize & Resume]** or **[Purge & Destroy Sandbox]**.
  - Click **[Purge & Destroy Sandbox]**.
  - Show the log line:
    `[SECURITY] Hard purge executed: docker rm -f sandbox-gvisor-xxx. State permanently wiped.`
  - The pipeline indicator lights up: **WIPED & PURGED**.
  - Extracted intelligence table shows the verified item with confidence score and breakdown.
- **Voiceover**:
  > *"As the operator, I inspect the challenge directly in the dashboard. I choose to reject and purge this compromised sandbox.*
  >
  > *The orchestrator issues `docker rm -f`, permanently wiping all cookies, temporary session storage, and memory states. The environment is destroyed, leaving zero lingering residue on our Vultr instance."*

---

### Scene 5: Architecture & Closing (2:30 – 2:45)
- **Visual**: Briefly scroll to the Extracted Intelligence Table with CSV/JSON export, then show the terminal running on Vultr or the architecture diagram.
- **Voiceover**:
  > *"Ghost Shopper empowers dropshippers and autonomous AI e-commerce stores to stay hyper-competitive with verified price intelligence, automated margin defense, and zero infrastructure risk.*
  >
  > *With goal planning, gVisor microVM isolation, secret hygiene, Vultr Serverless Vision AI verification, and stateful human approval, it brings enterprise security to e-commerce pricing.*
  >
  > *All code, Docker configurations, and Vultr deployment scripts are fully open-source in the GitHub repository. Thank you!"*

---

## 🎯 Pro-Tips for Recording
1. **Highlight the Contrast**: When the containment alert triggers, pause for 2-3 seconds so the viewer can read the red/orange log messages.
2. **Emphasize Vultr**: Mention *Vultr Cloud Compute*, *Vultr Serverless Inference (Llama 3.2 Vision)*, and *Vultr Cloud Firewall* explicitly.
3. **Show Real Controls**: Move the mouse purposefully to the "State Pipeline" and "Security Observability Matrix" meters to prove this is a live, dynamic dashboard.
