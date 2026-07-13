# PushVault — Feature Matrix & Competitor Comparison

*Compared against publicly documented plans of OneSignal, PushEngage, iZooto and WebPushr (as of early 2026 — verify before sales use). Legend: ✅ full · ⚠️ partial / paid add-on / higher tier · ❌ not offered.*

## Ownership & platform

| Feature | **PushVault** | OneSignal | PushEngage | iZooto | WebPushr |
|---|---|---|---|---|---|
| Self-hosted — your servers, your data | ✅ | ❌ SaaS only | ❌ SaaS only | ❌ SaaS only | ❌ SaaS only |
| No per-subscriber pricing (unlimited subscribers) | ✅ | ❌ per-sub tiers | ❌ per-sub tiers | ⚠️ quote-based | ⚠️ free to 60k, then paid |
| Multi-tenant / agency white-label (brand, logo, color) | ✅ | ⚠️ orgs, no white-label | ⚠️ agency plan | ⚠️ | ❌ |
| Tenant isolation enforced in the database (Postgres RLS) | ✅ | n/a (SaaS) | n/a | n/a | n/a |
| Per-property VAPID keys (full push identity ownership) | ✅ | ⚠️ | ❌ | ❌ | ⚠️ |
| Open codebase you can extend | ✅ | ❌ | ❌ | ❌ | ❌ |

## Capture & opt-in

| Feature | **PushVault** | OneSignal | PushEngage | iZooto | WebPushr |
|---|---|---|---|---|---|
| Two-step soft prompt (never blocks content) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Prompt designer: texts, color, logo, size, position | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Drag-to-place banner on live device preview (desktop + phone mockups) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Triggers: delay / scroll-% / exit-intent | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ |
| Re-ask cooldown in seconds/minutes/hours/days | ✅ | ⚠️ days only | ⚠️ | ⚠️ | ⚠️ |
| Automatic page discovery + per-page allow/block | ✅ | ❌ | ⚠️ rules only | ⚠️ | ❌ |
| Full UTM ad-campaign attribution on every subscriber | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |
| Geo / device / browser / language / timezone capture | ✅ | ✅ | ✅ | ✅ | ✅ |
| One-click domain install verification | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| Snippet size | ✅ ~3 KB gz | ⚠️ ~30 KB+ | ⚠️ | ⚠️ | ⚠️ |

## Leads & segmentation

| Feature | **PushVault** | OneSignal | PushEngage | iZooto | WebPushr |
|---|---|---|---|---|---|
| Dynamic segments (10 operators incl. engagement & recency) | ✅ | ✅ | ✅ | ✅ | ⚠️ basic |
| Manual add/remove leads per segment | ✅ | ⚠️ tags | ⚠️ | ⚠️ | ❌ |
| **Exclusive membership — one lead lives in one segment** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bulk assign-by-filter (status/geo/device/campaign/date/freshness) | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| **Auto-assign new leads by weighted ratio across segments** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Fresh-lead selection (never contacted) | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Status totals + per-lead status timeline (active/unsub/expired detected at) | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

## Campaigns & sending engine

| Feature | **PushVault** | OneSignal | PushEngage | iZooto | WebPushr |
|---|---|---|---|---|---|
| Send now / schedule / recurring (daily·weekly·monthly) | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Pause / Resume mid-blast (with mid-flight editing)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Custom pacing — any sends/minute | ✅ | ⚠️ throttling | ⚠️ | ⚠️ | ❌ |
| **Multi-segment targeting with lead mix (interleave / sequential / zone-wise)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| A/B testing with per-variant CTR + winner | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Live blast monitor (rate/min, queue drain, ETA — Vicidial-style)** | ✅ | ⚠️ basic | ⚠️ | ⚠️ | ❌ |
| Frequency caps enforced server-side (day + week) | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ |
| Dead-token pruning (404/410) + 429 backoff | ✅ | ✅ | ✅ | ✅ | ✅ |
| Action buttons (up to 2) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Click-to-call with number POOL + routing (round-robin / random)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Realistic per-OS previews (Windows / Android / macOS / iOS mockups) | ✅ | ⚠️ generic | ⚠️ | ⚠️ | ⚠️ |
| Basic vs Detail views + operator role (daily-ops staff can't edit content) | ✅ | ⚠️ roles | ⚠️ | ⚠️ | ❌ |

## Automation & revenue

| Feature | **PushVault** | OneSignal | PushEngage | iZooto | WebPushr |
|---|---|---|---|---|---|
| Drip / welcome series on subscribe | ✅ | ✅ Journeys | ✅ | ⚠️ | ⚠️ |
| Revenue attribution (click → conversion pixel) | ✅ | ⚠️ | ✅ | ⚠️ | ❌ |
| Server-side conversion webhook (API-key auth) | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| **Per-campaign CDR — per-lead cost records + CSV export** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Pay-per-click / pay-per-send billing rates for client invoicing** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plans & quotas with monthly metering | ✅ | ✅ | ✅ | ✅ | ✅ |

## Compliance & operations

| Feature | **PushVault** | OneSignal | PushEngage | iZooto | WebPushr |
|---|---|---|---|---|---|
| GDPR/DPDP hard-delete erasure (subscriber + history) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| No IP storage (coarse geo only) | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Full audit log with viewer | ✅ | ⚠️ enterprise | ❌ | ⚠️ | ❌ |
| Rate limiting on public endpoints | ✅ | n/a | n/a | n/a | n/a |
| Client portal (read-only, property-scoped logins) | ✅ | ⚠️ | ⚠️ agency | ⚠️ | ❌ |
| In-dashboard product updates from git (one-click self-update) | ✅ | n/a | n/a | n/a | n/a |

## Where competitors are currently ahead (honest gaps)

| Capability | Who has it | PushVault status |
|---|---|---|
| Native mobile app push (FCM/APNs SDKs) | OneSignal | ❌ web push only (by design, Phase 1–3 scope) |
| Email / SMS / in-app channels | OneSignal | ❌ push only |
| Managed global delivery infrastructure | all SaaS | ⚠️ you deploy it (Docker/K8s ready) |
| Cart-abandonment e-commerce triggers out of the box | PushEngage | ⚠️ achievable via drip + conversion webhook, not packaged |
| Push-ad monetization network | iZooto | ❌ not a goal |
| Hosted free tier with zero setup | WebPushr | ❌ self-hosted by nature |

**Bottom line:** PushVault's moat is *ownership + agency operations* — self-hosted data, white-label multi-tenancy, dialer-grade campaign controls (pause/resume, pacing, lead mixing, CDR billing, click-to-call pools) that no mainstream web-push SaaS offers, with no per-subscriber tax. SaaS rivals win on managed infrastructure and multi-channel breadth.
