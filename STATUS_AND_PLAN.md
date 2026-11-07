# Ghost Shopper — Status & Way Forward

**Last audited:** 6 Nov 2026, ~15:15 UTC (all findings below were verified by running the code, not by reading it)
**Submission deadline:** **8 Nov 2026, 6:00 PM EST (23:00 UTC)** — per lablab.build/ai-hackathons/vultr-hackathon
**Time remaining at time of writing: ~55 hours.**

---

## 1. The hard facts about this hackathon

Source: the live hackathon page.

- Name: **Vultr: Agent Rush Hackathon**. Online build **3–8 Nov 2026**; on-site finale 8 Nov, Salt Lake City.
- Prize pool: **$14,000** in competition prizes + on-site raffle (PS5 / AirPods / mouse). Up to $15,000 total.
- **We are already inside the build window.** It started 3 Nov. This is not pre-hackathon prep any more.
- Required track: **Challenge 01 — Blast Radius Zero**, **Pattern B (Sandboxed browser use)**.
- Pattern B is defined as: *user gives a goal → model plans → Playwright runs in a container → screenshots return → a vision model verifies → human approval before final actions.*
- Every participant gets **$200 free Vultr credits**.
- **Vultr GPUs are NOT available.** Challenge 1 **must** use Vultr Serverless Inference (`https://api.vultrinference.com/v1`) for agent LLM calls.
- Explicit judging language: *"real executed results rather than described ones"* and *"An agent that only chats is a demo; an agent that executes safely is a product."*

### Submission checklist (all six required)
| # | Requirement | Status |
|---|---|---|
| 1 | GitHub repository with setup and documentation | 🟡 Repo exists, docs exist, but quick start was broken (now fixed) |
| 2 | Vultr VM backend deployment | ✅ Live on Vultr Cloud Compute (140.82.12.47:8000) |
| 3 | Public demo URL | ✅ Live at [http://140.82.12.47:8000/](http://140.82.12.47:8000/) |
| 4 | Recorded demo video | ❌ Not done (script exists) |
| 5 | Clear architecture and use-case explanation | ✅ Strong — README + VULTR_SUBMISSION.md |
| 6 | **One containment moment shown in the video** | 🔴 **Currently faked** — see §3 |

---

## 2. What is genuinely real and working

This is a lot of real code — 11,216 lines across 30 files. Verified by running it:

- ✅ **Backend boots and serves.** `python orchestrator.py` → Uvicorn on `0.0.0.0:8000`, `GET /` returns 33,757 bytes of dashboard HTML, CSS and JS all serve 200.
- ✅ **Full REST + WebSocket surface is live.** `/api/goal`, `/api/scrape`, `/api/status/{id}`, `/api/pool/status`, `/api/config/vultr`, `/api/approve`, `/api/reject`, `/ws/logs` all respond correctly.
- ✅ **Pattern B pipeline executes end to end.** A goal submitted to `/api/goal` produced 3 tasks, ran them through PROVISIONING → EXECUTING → VERIFYING → COMPLETED → WIPED_AND_PURGED, wrote real `output.json` + `screenshot.png` files to disk, and returned `price=173.99 USD tier=TIER_1_LOCAL conf=0.95`.
- ✅ **Tier-1 verifier is real, non-trivial logic.** `_tier1_validate` genuinely handles European decimal commas, phone-number false positives, >90% discount anomalies, and a $1M upper bound.
- ✅ **Tier-2 Vision call is real.** `verifier.py` makes an actual `httpx` POST to `https://api.vultrinference.com/v1/chat/completions` with Bearer auth — not a stub. It is currently unexercised only because no API key is set.
- ✅ **`scrape.js` is a real Playwright worker.** 831 lines, real `chromium.launch()`, selector extraction, CAPTCHA/challenge keyword detection, HITL triggers.
- ✅ **Docker lifecycle manager is real code.** `sandbox_manager.py` (508 lines) with actual `docker pause` / `unpause` / `rm -f` calls, nano_cpus and memory limits.

**Bottom line: the skeleton is excellent. The problem is not architecture — it is that nothing real has ever flowed through it.**

---

## 3. The four blocking problems (verified, in priority order)

### 🔴 P0 — The containment demo is theatre, not containment
`orchestrator.py:1141`, `trigger_containment_moment()`. The SSRF demo is:

```python
await broadcast_log("SECURITY", "...Syscall intercepted by gVisor Sentry...")
await asyncio.sleep(1.0)
await broadcast_telemetry({..., "blocked_requests": 1})
```

**No container is created. No syscall is intercepted. No egress rule fires.** It prints log lines with sleeps between them and pushes the literal integer `1` to the UI counter.

This is the single most dangerous thing in the repo, because requirement #6 is *"one containment moment shown in the video"* proving containment is **real and verifiable**. Judges at this event include a Principal Engineer for Cloud and Network Security at Palo Alto Networks. A security judge who reads this will see instantly that `blocked_requests: 1` is a hardcoded literal, and the entire submission loses credibility.

### 🔴 P1 — Pattern B's "model plans" step has no model in it
`orchestrator.py:1055`, `submit_goal()`. The planner is:

```python
target_domains = ["amazon.com", "bestbuy.com", "walmart.com", "newegg.com"]   # hardcoded
synthesized_urls = [f"https://www.{target_domains[i % 4]}/dp/{target_slug}-{i+1}" ...]  # fabricated
plan_steps = [ "...7 fixed strings..." ]                                     # no LLM call
```

Verified live: the goal *"Compare Sony WH-1000XM5 headphones across top retailers"* produced
`https://www.amazon.com/dp/compare-sony-wh-1000xm5-headphones-acros-1`

That URL does not exist. It is the goal text slugified and appended to `/dp/`. **There is no search step, and no LLM is called anywhere in the planning loop.** This directly fails the Pattern B contract ("model plans") and the "real executed results rather than described ones" rule.

### 🔴 P2 — Prices are invented, not scraped
`orchestrator.py:902`, `_run_simulated_pipeline()`:

```python
mock_price = round(29.99 + (hash(url) % 250), 2)
```

Verified: the Sony WH-1000XM5 came back at **$173.99 on Amazon**. Real street price is ~$348. The number is a hash of the URL string. The screenshot is a hardcoded 1×1 PNG byte literal. If this ever reaches a judge in live mode, it is a fabrication risk, not a demo risk.

### 🟡 P3 — README quick start was broken (FIXED in this session)
`config.py` defaults `workspace_dir="/app/workspace"`, a container path. On any host, `orchestrator.py` died at import time:

```
PermissionError: [Errno 13] Permission denied: '/app'
```

**Fixed in commit `03ea7a4`** — `_resolve_workspace_dir()` now falls back to `./workspace` next to `orchestrator.py` and logs the fallback. Verified: the app now boots and serves.

---

## 4. The way forward — a 55-hour plan

The strategy is **narrow and deep, not wide and shallow**. We cannot scrape Amazon/Best Buy/Walmart — they will bot-block a hackathon VM and we would burn the remaining two days on anti-bot warfare. Instead: pick a target that is scrapable, and make containment *actually real* on it.

### Phase 1 — Make containment real (highest judging value) — ~10h
1. **Build a hostile test target.** A tiny FastAPI/Express app we control, serving pages that: fetch `169.254.169.254`, allocate memory until OOM, and show `$0.00` in DOM while rendering `$249.99` visually. This is a *legitimate* containment test fixture, and it is honest.
2. **Replace the scripted demo with real enforcement.** Launch a real container, let the hostile page actually try the SSRF, and let a real egress block actually drop it. Read the **real** blocked count from the container's network stats or a real proxy log — never a literal `1`.
3. **Prove the OOM kill for real.** Let the memory bomb run against the real 512MB cap and capture the real exit code 137.
4. **Ship gVisor or accept runc with honest labels.** If gVisor can't be installed in the time available, use plain Docker + `--cap-drop=ALL`, `--security-opt=no-new-privileges`, read-only rootfs, and **say so plainly**. Honest runc beats fake gVisor.

### Phase 2 — Make the planner real (Pattern B contract) — ~8h
5. **Wire an actual LLM planning call** to Vultr Serverless Inference. Goal in → JSON plan out (product name, search queries, retailer list). This is the step the whole Pattern B claim rests on.
6. **Add a real search step.** Use a scrape-friendly retailer, or a real shopping search API. The planner must produce URLs that exist.
7. **Keep a clearly-labelled simulation mode**, but make the UI say `SIMULATION` in large letters whenever it is active, so nobody can mistake it for live data.

### Phase 3 — Get it on Vultr (three hard requirements) — ~8h
8. Provision a Vultr Cloud Compute VM with the $200 credits. Docker + gVisor setup script already exists (`scripts/setup-gvisor.sh`).
9. Deploy the orchestrator there. `scripts/deploy-vultr.sh` exists — test it, don't trust it.
10. Get the inference key in, and **prove one real Tier-2 Vision call succeeds** against a real screenshot. Right now that code path has never executed.

### Phase 4 — Public URL + video — ~8h
11. Public HTTPS demo URL. `scripts/expose-public-demo.sh` exists (Cloudflare Tunnel / ngrok).
12. Record the video from `DEMO_VIDEO_SCRIPT.md`. **The containment moment must be the real one from Phase 1**, on camera, with the host visibly unaffected.

### Phase 5 — Submit — ~2h
13. Submit on **lablab.ai** (required for judging). Optionally also post to Vultr Community for exposure — that one is explicitly optional.

### Buffer — ~19h
Anti-bot surprises, VM issues, and video re-takes will eat this. Do not schedule it away.

---

## 5. The honest recommendation

We have ~55 hours and a strong skeleton. The winning move is to **cut scope aggressively**:

- **One product, one or two scrapable retailers, one real containment moment.**
- Drop the four-retailer fan-out fantasy. Judges score verifiable depth, not retailer count.
- **Never show simulated data as if it were live.** At an event whose entire premise is "real executed results rather than described ones", a fabricated price is an automatic credibility failure — and a fabricated *containment* demo is worse.

If Phase 1 (real containment) slips, submit anyway with honest runc isolation and a real SSRF block. A real, modest containment proof beats an elaborate fake one every time in front of a security judge.

---

## 6. Reproducing this audit

```bash
cd GhostShopper
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python orchestrator.py          # now boots; previously PermissionError
curl -s localhost:8000/api/config/vultr   # -> "mode": "simulation"
curl -s -X POST localhost:8000/api/goal -H 'Content-Type: application/json' \
  -d '{"goal":"Compare Sony WH-1000XM5 headphones across top retailers","concurrency":3}'
# -> fabricated /dp/<slug>-N URLs, prices from hash(url)
```
