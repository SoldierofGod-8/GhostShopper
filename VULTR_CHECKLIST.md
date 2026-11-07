# What You Need To Bring From Vultr

**Prepared:** 6 Nov 2026 ~15:30 UTC · **Deadline: 8 Nov, 6:00 PM EST** · ~54 hours left

Every env var name below was verified against `config.py`, which is the code that
actually reads them. Anything I could not verify from this sandbox is marked ⚠️ **UNVERIFIED**.

---

## A. Credentials (3 items)

| # | What | Env var (exact name) | Where to get it |
|---|---|---|---|
| 1 | **Vultr Cloud account API key** | `VULTR_API_KEY` | https://my.vultr.com/settings/#settingsapi |
| 2 | **Serverless Inference API key** | `VULTR_INFERENCE_API_KEY` | Vultr console → Inference section |
| 3 | **Vision model name** | `VULTR_VISION_MODEL` | ⚠️ **UNVERIFIED — see §C** |

These are the only two secrets the app needs. Everything else has working defaults.

> **Never paste these into chat.** Put them in `.env` (git-ignored, confirmed at
> `.gitignore:26`) or set them via the dashboard's config endpoint.

---

## B. The $200 credits — exact redemption path

From the live hackathon page:

1. **Register with an email NOT previously associated with any Vultr account.** This is stated as a hard requirement and it is the most common way people lose their credits.
2. Grab the gift code: https://lablab.ai/redeem-coupon/vultrai-coupon-vultr-agent-rush-hackathon
3. Apply it: https://console.vultr.com/billing/?promo=HACKATHON → **Gift Code** → **Apply**
4. **Confirm the account shows exactly $200.00 Remaining Credit.** Do not proceed until you see it.
5. ⚠️ **Add a payment method in Billing** if you want deployments to survive past the event. The page says credits and access "remain active throughout the event" but that keeping deployments afterward needs a payment method.

Credits cover: Compute Instances, Managed Databases, Kubernetes, other Vultr services.
**Vultr GPUs are NOT available for this event.**

---

## C. ⚠️ The model name is a guess and I could not verify it

The repo hardcodes:

```
VULTR_VISION_MODEL=llama-3.2-90b-vision-preview
```

**I could not confirm this model exists on Vultr Serverless Inference.** I tried
`https://api.vultrinference.com/v1/models` from this sandbox and got **HTTP 000** —
that host is not reachable from here. The `-preview` suffix looks like a Fireworks-style
identifier rather than a Vultr one, so treat it as suspect.

The hackathon page links a **live model list**: `https://api.vultrinference.com/v1/models`

**Action for you** — run this on your own machine:

```bash
curl -s https://api.vultrinference.com/v1/models \
  -H "Authorization: Bearer $VULTR_INFERENCE_API_KEY" | jq -r '.data[].id'
```

Paste the output back to me and I'll wire the correct model in. **Pick a vision-capable
one** — the page confirms "vision-capable models available" but doesn't name them.

This matters more than it looks: the Tier-2 Vision call in `verifier.py` is real code
that has **never once executed successfully**. If the model name is wrong, your entire
"vision model verifies" claim — half of Pattern B — is dead on arrival.

---

## D. Infrastructure decisions (2 items)

`scripts/deploy-vultr.sh` needs these. Defaults are `vc2-2c-4gb` / `ewr` (New Jersey).

| Item | Default | Note |
|---|---|---|
| **Plan** | `vc2-2c-4gb` (2 vCPU / 4 GB) | Minimum for Docker + gVisor. 4 GB is tight for 3 pooled sandboxes at 512 MB each — consider `vc2-4c-8gb`. |
| **Region** | `ewr` (New Jersey) | Pick whatever is cheapest/available in your credits. |
| **SSH public key** | `~/.ssh/id_ed25519.pub` then `~/.ssh/id_rsa.pub` | Script tries ed25519 first (line 119); falls back to password auth if neither exists. |

The script also needs `jq` and `curl` installed locally.

---

## E. Non-Vultr blockers I found while checking

### ✅ E1 — License conflict. RESOLVED.
The hackathon states: *"Submissions must be original and **MIT-compliant**."*

The repo previously had **no LICENSE file**, and `README.md` said:

> `Proprietary — Built for the Vultr Cloud Hackathon. All rights reserved.`

**Fixed:** an MIT `LICENSE` file was added at the repo root and that README line now
reads `MIT — see [LICENSE](LICENSE)`.

If you would rather keep this proprietary, delete `LICENSE` and revert that line — but
note the rules explicitly require MIT compliance, so shipping proprietary risks the
entry being rejected on a technicality.

### 🟡 E2 — Two deliverables nobody had on the list
The "What to submit" section requires more than the six-item checklist:
- **Slide presentation** ← not in the challenge brief
- **Cover image** ← not in the challenge brief
- Project title, short description, long description, technology & category tags

Budget ~2h for slides + cover image. They are graded under **Presentation**, which is one
of four judging criteria.

### 🟡 E3 — You must register in two places
lablab.ai **and** the lablab Discord. Both are stated as required to participate.

### ℹ️ E4 — Judging criteria (verbatim from the page)
1. **Application of Technology** — how effectively the model(s) are integrated
2. **Presentation** — clarity and effectiveness
3. **Business Value** — impact and practical value
4. **Originality** — uniqueness and creativity

Note: containment isn't a named criterion, but the challenge brief *requires* one
containment moment in the video, and "Application of Technology" is where a fake
containment demo does its damage.

---

## F. What I can build right now, without anything from you

Do **not** let the credential hunt block progress. These need no Vultr access:

1. **The real containment moment** — hostile test target + genuine SSRF block + genuine OOM kill. This is the highest-value item and needs zero credentials.
2. **The real LLM planner** — I can write and structure it against the OpenAI-compatible shape, with the model name as a config value. Swapping in the real name later is one line.
3. **Strip the fabricated prices** — make simulation mode shout `SIMULATION` in the UI so nothing fake can be mistaken for live data.
4. **LICENSE + README fixes.**

**Everything except the live Vision call and the VM deploy is unblocked right now.**

---

## G. Bring me these five things and we are fully unblocked

1. ✅ `$200.00` confirmed in Remaining Credit
2. ✅ `VULTR_API_KEY`
3. ✅ `VULTR_INFERENCE_API_KEY`
4. ✅ Output of the `curl .../v1/models` command above
5. ✅ ~~Your call on **MIT vs. proprietary**~~ — resolved: MIT `LICENSE` added

---

## Bug fixed this turn

`configure-vultr.py` writes `VULTR_API_KEY` to `.env`, but `Settings` had no such field
and pydantic-settings is configured with `extra="ignore"` — so the key never reached
`os.environ`. `GET /api/config/vultr` reported `vultr_api_key_configured: false` and
`mode: simulation` **even after a correct setup**, which would have sent you debugging
credentials that were fine.

Fixed in commit `77b09fd`. Verified: with `VULTR_API_KEY` in `.env`, the endpoint now
returns `vultr_api_key_configured: true` and `masked_account_key: "fake...tion"`.
