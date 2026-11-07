# 📝 Ghost Shopper — lablab.ai Submission Text

> Ready to paste into the submission form. Every technical claim below was
> verified against the code in this repo, not inferred from design intent.
> `RECORDING_ORDER.md` lists the claims to avoid and why.

---

## Project title

**Ghost Shopper — Blast Radius Zero competitor intelligence**

*Alternatives if the title needs to be shorter or more problem-led:*

- Ghost Shopper: hostile-web competitor pricing, contained
- Ghost Shopper — sandboxed price intelligence for dropshippers

---

## Short description

> **Full version — 599 characters, two paragraphs.** lablab's short field is often
> capped at 500. If it is, use paragraph 1 alone (291 characters, below). Both
> read as complete thoughts; nothing is left dangling mid-sentence.

Ghost Shopper is a competitor price intelligence layer for dropshippers. You give
it a product and a margin target; it plans a capture mission, dispatches headless
Chromium into a disposable container per retailer, and returns screenshots and
structured quotes from a Vultr-hosted control plane.

Every retailer page is treated as hostile. Workers run non-root with capabilities
dropped, no swap, a 512 MB ceiling and a hard watchdog. No API key or credential
is ever mounted into a sandbox, egress to cloud metadata and private ranges is
blocked, and each container is destroyed when its task ends.

### One-liner

Ghost Shopper scrapes competitor prices inside disposable, credential-free
sandboxes — because the blast radius of a bad web page should never be your store.

---

## Long description

*Use for the main project description. ~750 words.*

### The problem

Dropshippers operate on 12–20% margins, where a two-dollar pricing error is the
difference between a sale and a loss. Repricing means watching competitors
constantly — and the obvious way to do that is to scrape them.

That is where it gets dangerous. Competitor pages are not just data sources; they
are untrusted code that your infrastructure has to render. A page can ship a
memory bomb, chain redirects, attempt SSRF against the cloud metadata endpoint, or
serve a `$0.00` price in microdata designed to fool repricing bots into pricing
below cost. Scrapers that share an IP or network with the storefront can take the
storefront down with them. The technical problem is not scraping. It is containing it.

### What Ghost Shopper does

Ghost Shopper is a centralized control layer hosted on Vultr Cloud Compute. The
operator supplies a goal — a product and a margin target. The orchestrator plans
the mission, then dispatches one ephemeral headless Chromium worker per retailer,
capturing them in parallel. Each worker returns a screenshot and a structured
price extract into a shared workspace. Results are aggregated into a price band
(median with interquartile bounds where the sample supports it) rather than a
single misleading number, and every quote carries a provenance label — `live` if
a real capture produced it, `synthetic` if it was generated — so nothing
unverified is presented as observed fact.

Repricing is a decision, not an action: anomalous prices raise an approval
request to the operator, and the system never autonomously purchases or
republishes a price.

### Containment: what is actually enforced

The design assumes every target page is hostile and every worker is expendable.

**Process isolation.** One container per task, non-root worker user, all Linux
capabilities dropped (`--cap-drop=ALL`) and `no-new-privileges` set, so there is
no privilege-escalation path from inside. Workers cannot see one another.

**Secret hygiene.** A sandbox receives a task ID, a target URL, a batch ID, the
egress blocklist and a workspace path — and nothing else. Fabric or Vultr API
keys exist only in the orchestrator process. There is no credential inside a
worker container to steal, which is the property that makes the SSRF scenario
boring rather than fatal.

**Resource limits.** 1.0 vCPU, a 512 MB memory ceiling with swap pinned equal to
the cap so it cannot spill, and a 60-second watchdog. A runaway page dies at the
boundary; the host stays responsive.

**Lifecycle discipline.** Workers are short-lived and removed with `docker rm -f`
on completion, failure, timeout or rejection, reaching a terminal
`WIPED_AND_PURGED` state. Cookies, cache, local storage and memory go with the
container.

**Egress blocking.** Outbound traffic to the cloud metadata endpoint and to
link-local, loopback, and RFC1918/CGNAT space is dropped, closing the SSRF path a
hostile page would use to reach instance credentials.

### Where Vultr fits

- **Vultr Cloud Compute** runs the FastAPI orchestrator: task planning, container
  lifecycle management over the Docker API, a pre-warmed worker pool to remove
  cold starts, WebSocket telemetry, and the approval gate.
- **Vultr Serverless Inference** is called from the orchestrator to structure and
  sanity-check competitor pricing responses. The call happens outside the
  sandbox; no inference credential ever crosses the container boundary.

### Honest status

This was built under hackathon time constraints, and the containment layer is
ahead of the pricing layer.

**Working and demonstrated:** the orchestrator running publicly on a Vultr
instance; per-task sandbox creation, execution and purge; the egress blocklist;
resource caps and the watchdog; parallel capture with screenshot artifacts;
provenance labelling; the operator approval flow; MIT-licensed source.

**Known gaps, stated plainly:**

1. When the inference call fails — which it does when the configured model name
   does not resolve — pricing falls back to a deterministic-by-intent but
   currently non-deterministic heuristic. It produces plausible figures, not
   observed ones. Fixing the model configuration and wiring the worker's real
   extracted prices through the API response is the next milestone.
2. gVisor (`runsc`) is supported as a drop-in runtime but is **not installed** on
   the current host. Containment therefore rests on namespaces, cgroups, dropped
   capabilities and egress rules — a real boundary, but a weaker one than
   syscall interception would provide.
3. The in-app containment demonstration streams the containment narrative to the
   dashboard; the enforcement it describes is real, but the demo scenarios
   themselves are illustrative rather than live attacks.

We would rather hand judges an accurate map than a flattering one.

### Why it matters commercially

The cost of an unprotected scraper is not compute — it is a revenue outage during
peak season, or leaked cloud credentials from a malicious page. Ghost Shopper
makes the safe version of competitor monitoring the default one, on infrastructure
that bills by the hour and destroys its workers when the job is done.

---

## Suggested tags

**Challenge:** Challenge 01 — Blast Radius Zero · **Pattern B: Sandboxed Browser Use**

**Use case:** Comparison Shopper

**Technology tags:** Vultr Cloud Compute · Vultr Serverless Inference · Docker ·
Playwright · Chromium · FastAPI · Python · JavaScript · WebSockets · cgroups ·
Linux namespaces · egress filtering

**Category:** Developer Tools · E-commerce · Automation · Security

---

## Video title

> Ghost Shopper — Blast Radius Zero competitor intelligence on Vultr

---

## Asset checklist

| Submission field | Value |
|---|---|
| Public GitHub repo | `https://github.com/SoldierofGod-8/GhostShopper` |
| Demo platform | Vultr Cloud Compute (Ubuntu 24.04, 2 vCPU / 8 GB) |
| Application URL | `http://140.82.12.47:8000/` |
| Cover image | `frontend/assets/cover-image.png` |
| Slide presentation | `slides/GhostShopper-deck.html` → Print → Save as PDF |
| Video | Record per `slides/RECORDING_ORDER.md` |
| License | MIT |
