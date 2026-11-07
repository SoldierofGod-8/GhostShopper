# 🎥 Recording Order — Ghost Shopper

> **Why this file exists.** `DEMO_VIDEO_SCRIPT.md` describes an ideal run. Some of
> what it narrates is not true of the build that is deployed today, and a judge
> can check the repository. This is the same story told with only claims that
> survive scrutiny, in an order that records cleanly in one take.
>
> **Deadline: Nov 8 2026, 6:00 PM EST.**

---

## Before you press record

| Check | Command / action |
|---|---|
| Container healthy | `docker compose ps` → `Up (healthy)` |
| Public demo answers | open `http://140.82.12.47:8000/` in a **fresh** window |
| Browser cache cleared | **Ctrl+Shift+R** once, before recording |
| Sandbox image present | `docker images \| grep ghost-shopper-sandbox` |
| Deck open in another tab | `slides/GhostShopper-deck.html` |
| Resolution | 1920×1080, browser full screen |
| Notifications off | Windows Focus Assist **on** |

Do one full search and one containment run **before** recording, so the warm pool
is primed and the first on-camera search is not the cold one.

---

## The order that works

### 1. Cold open — the claim (0:00–0:15)

Show the dashboard. Say the thesis, nothing else:

> "In dropshipping, margin is 12%. Reprice one cent wrong and you lose money.
> But scraping competitors is hostile work — and the blast radius is your own
> store. This is Ghost Shopper: a control layer that runs every request inside a
> disposable sandbox on Vultr."

### 2. Architecture, 20 seconds (0:15–0:35)

Switch to the deck, **slide 5** (Architecture). Point at the two planes:

> "One control plane on Vultr Cloud Compute. Many disposable workers. The
> sandbox gets a task ID and a URL — and nothing else. No API keys ever enter it."

### 3. The search — live (0:35–1:15)

Back to the dashboard. Run a search on camera.

Watch for the log stream, the sandbox cards, and the Vision Viewport filling with
captures. Let it finish naturally.

> "Three retailers, captured in parallel, one container each. Every quote comes
> back with the screenshot that produced it, labelled live or synthetic so you
> know which is which."

⚠️ **Do not narrate the price figures as real market prices.** Say "the evaluated
median" and move on. See *What not to say* below.

### 4. THE CONTAINMENT MOMENT (1:15–1:55) — the graded scene

This is the scene the rubric is actually scoring. Give it the most care.

Trigger the containment demo from the dashboard, then show the log:

```
[SECURITY BLOCKADE] Target script attempted outbound call to 169.254.169.254:80
```

> "The page is real and the request is real — it is trying to read cloud metadata.
> It dies at the boundary. And notice what it would have found: nothing. There
> are no credentials inside this container to steal. When the task ends, the
> container is destroyed."

Then show the purge: `WIPED_AND_PURGED` in the lifecycle pipeline.

**Say the scope note out loud, once, plainly:**

> "This host runs the standard Docker runtime, so containment here is namespaces,
> cgroups, dropped capabilities, and an egress blocklist — not gVisor's syscall
> interception. gVisor is a drop-in runtime we support; it isn't installed on
> this VM."

Judges trust a stated limit far more than an overclaim they can catch.

### 5. Close (1:55–2:15)

Deck **slide 10**. Public URL + repo on screen.

> "Public demo, MIT licensed, source on GitHub. Blast Radius Zero."

Stop recording. **Do not** pad to fill time.

---

## What not to say — and why

| Don't say | Why |
|---|---|
| "Prices are real market prices" | The fallback is a hash of the query, not an observation. A $98 MacBook Air is checkable in one second. |
| "gVisor microVMs" | gVisor is not installed on the VM. Container ≠ microVM. |
| "gVisor intercepts the syscall" | Same. The block is iptables + container networking. |
| "Vultr Vision AI verified this price" | Only true when the inference call actually ran. Do not assert it per-frame. |
| "Zero-trust, fully hardened" | Overclaiming invites a hunt for the exception. State the four controls instead. |

Saying *"the pricing layer is the next milestone"* costs a fraction of a point.
Being caught inventing a number on camera costs the Business Value score.

---

## Export

- Resolution 1080p, H.264, under 3 minutes
- Upload unlisted to YouTube, keep the link for lablab.ai
- Cover image for the submission: `frontend/assets/cover-image.png`
- Slides: `slides/GhostShopper-deck.html` → open in Chrome → **Print → Save as PDF**
  (already sized 1280×720, one slide per page)
