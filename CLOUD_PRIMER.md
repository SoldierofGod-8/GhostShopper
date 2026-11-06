# Cloud Computing Primer — Written For This Project

A plain-language glossary of every term used in Ghost Shopper and the Vultr
hackathon. Written for someone doing this for the first time.

---

## 1. "Is Vultr a VPS? A PaaS?" — the honest answer

**Vultr is mainly IaaS, not PaaS.** Here's the standard three-layer split:

| Layer | Name | What you get | Analogy | Examples |
|---|---|---|---|---|
| **IaaS** | Infrastructure as a Service | A raw computer. You install the OS packages, the runtime, everything. | You rent an **empty kitchen** with a stove. You buy food, cook, and wash up. | **Vultr Cloud Compute**, AWS EC2, DigitalOcean |
| **PaaS** | Platform as a Service | You hand over your code; they run it. No servers to manage. | You rent a kitchen with **ingredients and pans already prepped**. You just cook. | Heroku, Render, Railway, Vercel |
| **SaaS** | Software as a Service | A finished product you log into. | You **order a meal at a restaurant**. | Gmail, Slack, Notion |

### So is it a VPS?
**Yes, essentially.** A Vultr "Cloud Compute instance" *is* a VPS — a **V**irtual
**P**rivate **S**erver. Vultr just uses "Cloud Compute" as the marketing name.

A VPS is a slice of one big physical server, created by software called a
**hypervisor**. Your slice behaves exactly like a real, independent computer: it
has its own IP address, its own disk, its own operating system, and it reboots
independently of its neighbours.

### But Vultr isn't *only* IaaS
They layer some managed products on top that blur the line:
- **Managed Databases** — they run Postgres/MySQL for you (that part is PaaS-like)
- **Kubernetes** — managed container orchestration
- **Marketplace apps** — Supabase on Vultr, Coolify on Vultr (one-click PaaS)
- **Serverless Inference** — you call an AI model, they run the GPUs

**For our hackathon:** we use Vultr as **IaaS** (a VM we control completely) plus
**Serverless Inference** (a managed AI service). That combination is exactly what
Challenge 1 asks for — Vultr as "the central system of control and orchestration,
not just static hosting."

> Why IaaS and not PaaS for this project? Because our whole pitch is *containment*.
> We need to install Docker and gVisor and destroy containers constantly. A PaaS
> would never let us do that.

---

## 2. The server terms

### Instance / VM / VPS / server
All four words mean roughly the same thing here: one rented virtual computer.

### Region
Which datacentre your server physically lives in. `ewr` = New Jersey. Others
include `lax` (Los Angeles), `lon` (London), `ams` (Amsterdam), `blr` (Bangalore).
Pick one near your users — or near you while testing.

### Plan
The size of the machine. Our default is **`vc2-2c-4gb`**, which decodes as:
- `vc2` — the product family
- `2c` — **2 vCPUs**
- `4gb` — **4 GB RAM**

### vCPU
A **virtual** CPU. One core of a physical processor, shared out by the hypervisor.
2 vCPUs ≈ the power of 2 real cores, most of the time.

### RAM
Memory. Programs live here while running. Ours is capped at **512 MB per sandbox** —
that cap is one of our containment controls (a runaway page hits the ceiling and dies
instead of eating the whole server).

### SSH and SSH keys
**SSH** is how you log into a remote Linux server over the internet.

An **SSH key pair** is two files:
- **Private key** (`~/.ssh/id_ed25519`) — your secret. Never share it. Like your house key.
- **Public key** (`~/.ssh/id_ed25519.pub`) — safe to share. You give this to the server. Like the lock you install on the door.

You upload the *public* key to Vultr; Vultr puts it on the new server; only someone
holding the matching *private* key can log in. No password to guess.

Generate one with: `ssh-keygen -t ed25519`

---

## 3. The two different API keys — this trips everyone up

There are **two completely separate keys** in this project. They are not interchangeable.

| | **Account API key** | **Inference API key** |
|---|---|---|
| Env var | `VULTR_API_KEY` | `VULTR_INFERENCE_API_KEY` |
| Where | Console → **Account → API** | Console → **Products → Serverless → Inference** → click your subscription → **Overview** |
| Controls | Your **entire account**. Create servers, delete servers, spend money. | **Only** AI model calls, billed per token. |
| Danger level | 🔴 Very high — can destroy your infrastructure | 🟡 Moderate — can run up an inference bill |
| Used by | `scripts/deploy-vultr.sh` (provisions the VM) | `verifier.py` (sends screenshots to the vision model) |

**This is exactly why pasting the account key in chat was the dangerous one.**

---

## 4. How to get the Serverless Inference key

You must **create a subscription first** — the key doesn't exist until you do.

**Step A — Create the inference subscription**
1. Console → **Compute** → **Serverless Inference**
2. Click **Create Inference**
3. Enter a **Label** (any name, e.g. `ghost-shopper`)
4. Optionally click *prices for every model* to see the per-model rates
5. Tick **I acknowledge the usage-based cost**
6. Click **Create Inference**
7. Confirm it shows status **Active**

**Step B — Copy the key**
1. Console → **Products** → **Serverless** → **Inference**
2. Click the subscription you just made
3. On the **Overview** page, copy the **API Key**

That string is your `VULTR_INFERENCE_API_KEY`.

> ⚠️ **Billing question worth checking:** the hackathon says the $200 credits cover
> "Compute Instances, Managed Databases, Kubernetes clusters, and other Vultr
> services." It does not explicitly name Serverless Inference. Inference is
> **usage-based billing**, so confirm in the console whether your credits absorb it.
> I could not verify this from here.

---

## 5. Containers and sandboxes — our containment story

### Docker
Software that packages a program plus *everything it needs* into a sealed box called
a **container**. The box runs the same everywhere.

### Image vs container
- An **image** is the frozen template — like a recipe or a snapshot. (`Dockerfile.sandbox` builds ours.)
- A **container** is that image *running* — like a cake actually baked from the recipe.

You can start 100 containers from one image, and destroying a container never touches
the image.

### Why containers aren't enough on their own
Normal Docker containers **share the host's Linux kernel**. If a program inside
exploits a kernel bug, it can escape. For running *untrusted* code — a hostile
retail webpage — that's not good enough.

### gVisor / runsc
Google's fix for exactly that. It's a **"user-space kernel"**: it sits between the
container and the real kernel and intercepts every system call, deciding what's
allowed. A compromised browser inside gVisor has no direct path to the host kernel.

`runsc` is the name of the gVisor program; `DOCKER_RUNTIME=runsc` tells Docker to use it.

### Sandbox
Any throwaway, isolated environment where untrusted code runs. Ours: a gVisor
container, 1 vCPU, 512 MB RAM, destroyed after every task.

### Egress
**Outbound** network traffic — the container calling out to the internet.
(Ingress is the reverse: traffic coming in.) We *block* egress to internal addresses.

### SSRF and `169.254.169.254` — the attack we contain
**SSRF** = Server-Side Request Forgery. Tricking *your* server into making a request
on the attacker's behalf.

`169.254.169.254` is a magic address that exists inside almost every cloud server. Ask
it nicely and it hands back your server's secrets — API keys, credentials, everything.

So a hostile webpage can include:
```javascript
fetch("http://169.254.169.254/latest/meta-data/")
```
and if your scraper obeys, your cloud credentials leak. **That is the "containment
moment" we need to show on camera** — our sandbox must refuse that call.

### Blast Radius Zero
Borrowed from explosives: if something detonates, how far does the damage reach?
Our claim: the blast is contained to a 512 MB box that we then delete. The host server,
database, and API keys are untouched.

---

## 6. The AI / inference terms

### Serverless Inference
You rent *calls* to an AI model. You never see a GPU, never install anything, never
manage a server. You send a request; you get an answer; you're billed for what you used.

"Serverless" does **not** mean no servers — it means *no servers for you to manage*.

### Why this matters for the hackathon
Vultr **GPUs are not available** for this event. So instead of renting a GPU and
running a model ourselves (expensive, slow, hard), we call their hosted models.
The hackathon **requires** Challenge 1 to use Serverless Inference for agent LLM calls.

### OpenAI-compatible API
Vultr's inference endpoint accepts **the same request format as OpenAI's**. Base URL:

```
https://api.vultrinference.com/v1
```

That means code written for OpenAI works with a one-line URL change. It's why
`verifier.py` looks like ordinary OpenAI client code.

### API key / Bearer token
The password for programmatic access. Sent in an HTTP header:

```
Authorization: Bearer YOUR_KEY_HERE
```

"Bearer" means *"whoever carries this token is allowed in"* — which is exactly why
leaking one is dangerous. There's no second factor.

### Tokens
How LLMs measure text. Roughly **1 token ≈ 4 characters**, or ~0.75 of an English word.
You're billed per token, separately for input and output.

### Vision model / multimodal
A model that can **look at images**, not just read text. We send it a screenshot of a
product page and ask "what price is actually visible?"

This is a genuine security feature for us: a hostile page can hide fake text in its
HTML (`price: $0.00`) but it cannot easily fake what's visibly *rendered on screen*.

### Model names — ⚠️ still unverified
Our config hardcodes `llama-3.2-90b-vision-preview`. I could not reach
`api.vultrinference.com/v1/models` from this sandbox to confirm it exists. Vultr
appears to use **namespaced** IDs (one of their own docs references a model written as
`moonshotai/Kimi-K2.5`), so a bare `llama-3.2-90b-vision-preview` looks wrong in shape.
**Run the models query and send me the real list.**

---

## 7. How the pieces fit together

```
YOU (browser)
   │
   ▼
VULTR VM  ← the IaaS part. One rented computer in New Jersey.
   │
   ├── orchestrator.py ──── the "boss". Receives your goal, plans, dispatches,
   │                        reports back. Runs on the VM, outside the sandbox.
   │        │
   │        ├──► gVisor sandbox #1 ── Playwright browser ──► hostile website
   │        ├──► gVisor sandbox #2 ── Playwright browser ──► hostile website
   │        └──► gVisor sandbox #3 ── Playwright browser ──► hostile website
   │             (1 vCPU, 512 MB, no secrets, destroyed after each task)
   │
   └── verifier.py ──HTTPS──► api.vultrinference.com  ← the AI part.
                               "Here's a screenshot. What price is visible?"
```

**The critical security property:** the API keys live *only* on the VM, in
`orchestrator.py` and `verifier.py`. **Zero credentials are ever put inside a
sandbox.** So even if a hostile webpage achieves full remote code execution inside
the browser, there is nothing there worth stealing.

That single design decision is the backbone of the whole submission.

---

## 8. Cheat sheet — commands you'll actually use

```bash
# Make an SSH key (one time)
ssh-keygen -t ed25519

# Log into your Vultr VM
ssh root@YOUR_VM_IP

# Check the real list of AI models available to you
curl -s https://api.vultrinference.com/v1/models \
  -H "Authorization: Bearer $VULTR_INFERENCE_API_KEY" | jq -r '.data[].id'

# Check your account balance (uses the account key — keep it safe)
curl -s https://api.vultr.com/v2/account \
  -H "Authorization: Bearer $VULTR_API_KEY" | jq
```
