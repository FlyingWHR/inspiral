# Borrowed Attention, Verifiable Memory

**A first-principles interrogation of the affinity thesis, and an implementable affinity spec for Inspiral**

Written 21 August 2026 · Jam deadline 28 August 2026 · Grounded in the repo at the commit read below

> **For the engineer.** Part 1 is argument and you can skip it. Parts 2–4 are the spec.
>
> **Start at [§3.0](#30-implementation-status--read-this-first).** It assesses the work already in your working tree — `significance.ts`, the re-rank wiring, `consequenceScore`, and the clock patrol — and lists three measured defects. One of them (the patrol writing to `wren` and `ash` with no `synthetic` flag) gets worse every hour the clock runs, so it is the first thing to fix.
>
> Everything to build is in **§3.2 – §3.9**: tables, query logic, thresholds, output shapes. Supporting SQL is in [`docs/affinity/002-affinity-tables.sql`](affinity/002-affinity-tables.sql) and [`docs/affinity/queries.sql`](affinity/queries.sql), both copy-pasteable and both validated against a copy of `canon.db`. §3.7 defines what significance should be computed from; §3.8 specifies the patrol properly.
>
> Uncommitted on purpose. `git add docs/` — the working tree has unrelated in-flight changes.

---

## Epistemic status and method

Part 1 argues. Parts 2–4 specify. Everything in Parts 2–4 is grounded in code read on 21 August 2026: `SCHEMA.md`, `src/canon/db.ts`, `src/canon/repo.ts`, `src/canon/digest.ts`, `src/config.ts`, `src/types/events.ts`, `src/types/canon.ts`, `src/types/directive.ts`, `src/directive/apply.ts`, `src/tick/runTick.ts`, `src/tick/visitors.ts`, `src/runtime/character.ts`, `src/runtime/surface.ts`, `src/ip/outbound.ts`, `src/ip/source.ts`, `scripts/showrunner.ts`, `scripts/clock.ts`, `tests/citing.test.ts`, `tests/tick.test.ts`, `package.json`, and the three live SQLite databases in `data/`.

Three findings from that read change the shape of the answer, so they go first rather than buried:

1. **There are zero visitor rows in every persisted database.** `data/canon.db` (128 events, 44 ticks, world `Tallow Ward`, running since 18 Aug), `data/tradeclash.db` (73 events), and `data/voxel.db` (8 events) all have empty `visitors`, `visitor_stance`, `visitor_interactions`, and `visitor_moments` tables. Every visitor beat in this project exists only inside an ephemeral demo run. An affinity model over canon is therefore a model over *a table shape that has never held a row in anger*. That is not a reason not to build it — it is a reason to build it so that running the world populates it, and to be scrupulous on camera about the n. §3.8 specifies the patrol that fixes this without fabricating a result.

2. **`significance_hint` is not re-ranked anywhere, contradicting the schema's own claim.** `SCHEMA.md` §1 and `src/types/events.ts:81` both assert: *"ADVISORY ONLY. Canon recomputes real significance on read, so a host that flatters itself cannot inflate its way into permanent memory."* No such recomputation exists. `selectClips` (`outbound.ts:76,80`) filters and sorts on raw `significance_hint`. `showrunnerNote` (`outbound.ts:171–172`) does the same. `findGrievance` (`character.ts:144,150`) gates at `>= 0.4` and sorts on it. `bible.ts:124` and `onboard.ts:44` sort ingested items on it. The host's self-assessment is load-bearing at every read site in the system. **§3.7 defines the replacement.**

3. **The engagement→significance→selection loop is already closed.** `normalizeItem` (`source.ts:231–247`) computes `engagement = likes + 3×comments + views/1000` and then `significance = min(0.95, 0.25 + log₁₀(1+engagement)/8)`. That number becomes `significance_hint` on an ingested event, which then determines whether the event is clip-worthy, grievance-worthy, and digest-worthy. Platform engagement is already the hidden objective function of this codebase. The thesis says a creator should optimise for something deeper than engagement; the code currently launders engagement into "significance" and calls it canon. **§3.7 replaces this too.**

Citations for Part 1 are collected in Appendix B. Where a widely-repeated statistic is poorly sourced, it says so rather than repeating it.

---

# Part 1 — The thesis, taken seriously and then attacked

## 1.1 The steelman

Stated at its strongest, without the aphorisms:

Audience relationships are a stock, not a flow. Any single piece of content produces a flow (views, this week's reach), but the durable asset is the stock of people for whom your next piece of content starts from a position of earned credibility rather than zero. Content is the investment; the stock is the return. Platform metrics measure the flow because the flow is what platforms sell. The creator's interests and the platform's interests diverge precisely here: the platform is indifferent between a view that builds the stock and a view that depletes it, because both are inventory. The creator is not indifferent, because only one of them lowers the cost of the *next* view.

The six-level ladder — Stop, Hold, Reward, Signal, Convert, Compound — is a claim that a single content event has a conditional cascade structure, and that measurement conventionally truncates at level one. This is straightforwardly correct as a structural observation. It is the same observation as a funnel, with one non-standard and genuinely interesting addition: **Compound is not a funnel stage.** Stop through Convert describe one encounter. Compound describes the *derivative* — whether this encounter changed the prior for the next one. Funnels do not have that term. Adding it is the thesis's real contribution.

And the frame contains an implicit theory of failure that is worth stating: content can have *negative* returns at the stock level while having positive returns at the flow level. A sensational post that wins the Stop and loses the Reward doesn't just fail to compound; it teaches the audience that your Stop is not predictive of your Reward, which raises the cost of every future Stop. That is a real mechanism and most engagement dashboards are structurally incapable of detecting it.

## 1.2 Where the frame is right, and what actually supports it

**Attention is scarce and must be allocated.** Simon (1971) is the correct citation and the wording holds up: "a wealth of information creates a poverty of attention and a need to allocate that attention efficiently among the overabundance of information sources that might consume it." But note what Simon did *not* say. His frame is administrative and economic — attention as a scarce input to be budgeted by organisations, measured in time because humans are "essentially serial devices." There is nothing relational in Simon. No loan, no reciprocity, no obligation. **Citing Simon for "attention is a loan" is a misattribution.**

**The relational claim's real source is Horton & Wohl (1956)**, and it is a better fit than the thesis realises. They coined "para-social relationship" for the "seeming face-to-face relationship between spectator and performer," and identified the *obligation* dynamic directly: "The audience... is expected to assume a sense of personal obligation to the performer." They also named the failure mode: the relationship is "one-sided, nondialectical, controlled by the performer, and not susceptible of mutual development," producing "growth without development" — accumulation of one-sided history without mutual evolution. That last phrase is worth holding onto: it is precisely what a world with a perfect log and no disclosure variation produces. §3.6 is the design response.

**The disenchantment mechanism is real and Wu names it.** *The Attention Merchants* (2016) defines the attention merchant as "an industrial-scale harvester of human attention — a firm whose business model is the mass capture of attention for resale to advertisers," and traces a repeating cycle in which each harvesting regime eventually provokes revolt as its mechanics become visible. I could not page-verify the exact phrase "disenchantment effect" against the primary text; multiple independent reviews converge on it, so treat it as reliable-but-not-page-cited.

**Engagement genuinely is not retention, and this is not folk wisdom.** Andrew Chen's formulation is the cleanest and is directly quotable: retention is "the act of getting users BACK to revisit, regardless of their actual activity"; engagement is "how much time they spend with the product, how many features they interact with" — and "engagement doesn't necessarily correlate with monetization... Keep this in mind for people who espouse 'addictiveness' and 'engagement' as virtues for social media sites." He gives Google as high-retention/low-engagement, showing the two axes are genuinely orthogonal rather than correlated-with-noise.

**Engagement metrics are technically defective as quality proxies, with formal evidence.** Wu, Rizoiu & Xie (ICWSM 2018) analysed 5.3M YouTube videos and showed raw watch time confounds duration, topic, and channel size; their "relative engagement" measure — normalised against those confounds — is stable over time and correlates with independently-assessed quality where raw engagement does not. The duration-bias literature separately documents that longer videos are systematically over-weighted in watch-time-optimised recommenders independent of viewer satisfaction. The advertising industry has partly conceded the point: Nelson-Field's attention-measurement work and the Dentsu/Amplified Intelligence studies exist because impressions and viewability were understood to measure the wrong thing.

So the frame's diagnosis — *the standard metric truncates the cascade at level one, and the truncation is not innocent* — is well supported.

## 1.3 Where the frame is folk wisdom

**"Attention is a loan" is a metaphor doing work it hasn't earned.** A loan has a principal, a term, an interest rate, and a default condition. The metaphor implies unrepaid attention creates a *debt* — that the audience is owed something and will collect. Nothing in the attention literature supports a debt mechanism. What actually happens when content disappoints is more banal: the audience updates a prior and reallocates. There is no debt, no collection, no ledger. The metaphor smuggles moral obligation in where there is only Bayesian updating. This matters because it flatters the creator into thinking a bad post creates a *specific* liability to specific people, when in reality it produces a small downward revision in a distribution — usually below the noise floor of anything measurable.

**"Their experience determines whether the next second becomes easier or harder to earn" is the load-bearing claim and it is asserted, not evidenced.** The strong version — that content quality has a persistent, measurable effect on *individual-level* future attention probability — is an empirical claim about within-person dynamics. The literature is thin, largely survey-based, and mostly measures stated intention rather than behaviour. The parasocial-to-purchase literature (2023 *Sustainability* meta-analysis: 176 effect sizes, 62 studies, ~22,554 participants) supports parasocial relationship as a *mediator* between influencer attributes and purchase intention — but it is cross-sectional survey work with self-reported outcomes, and "purchase intention" is not purchase. A widely circulated Twitch figure claiming parasocial variables explain 33.7% of variance in donation behaviour could not be traced to a peer-reviewed source; **do not use it.**

**"Virality wins a moment; affinity wins a market" is a slogan, and as literal economics it is probably backwards.** Which brings us to the crux.

## 1.4 The crux: Sharp versus the affinity thesis

The thesis says: optimise for depth of relationship with the right people; reach without affinity is hollow. Byron Sharp's Ehrenberg-Bass programme says approximately the opposite, and says it with more data.

**What Sharp actually claims, precisely:**

- **Double Jeopardy** (McPhee 1963; Ehrenberg 1966; Ehrenberg, Goodhardt & Barwise 1990; replicated at 50 years by Sharp et al. 2018): smaller brands suffer twice — fewer buyers, *and* those buyers are slightly less loyal. Loyalty varies little between brands; share differences are driven overwhelmingly by penetration.
- **The NBD-Dirichlet model** (Goodhardt, Ehrenberg & Chatfield 1984) predicts penetration, frequency and repeat-buying from share and category norms alone — and derives Double Jeopardy as a *mathematical consequence of statistical selection among substitutable options*, not as a psychological loyalty effect. This is the sharpest blade in the argument: the loyalty pattern the affinity thesis wants to explain with relationship quality is reproduced by a model containing no relationship term at all.
- **Growth comes from acquisition, not retention.** Riebe, Wright, Stern & Sharp (2014, *Journal of Business Research*): growing brands out-acquire; declining brands under-acquire; retention rates vary far *less* across winners and losers than acquisition rates do.
- **Heavy buyers matter less than folklore says.** Sharp, Romaniuk & Graham (2019): "It's wrong to talk about an 80/20 law in marketing... almost half of your brand's sales will always come from your very lightest 80% of buyers." Roughly 50/20 annually, ~60/20 over five years.
- **Brand love is a category error.** Sharp has publicly called "build brands people love" thinking "so misguided... an embarrassment to marketing."
- **Mental availability beats differentiation.** Pursue distinctiveness (memorable, ownable assets), not meaningful differentiation.

**If Sharp is right, the affinity thesis is not merely incomplete — it is a prescription for optimising the variable that doesn't move.**

**Now the honest reconciliation, which is not a dodge because it turns on a structural distinction Sharp's own institute concedes.**

Ehrenberg-Bass's "Answering critics" page states that in *subscription markets* — where each buyer holds a repertoire of roughly one — "penetration growth comes entirely from recruiting new customers," whereas in repertoire markets it comes from recruitment *and* increasing the frequency of light buyers. This is a significant admission. Double Jeopardy's loyalty component is a *frequency* phenomenon in repertoire categories. In repertoire-of-one categories, "loyalty" collapses into a binary retain/churn decision — a qualitatively different object. Sharp's data is drawn overwhelmingly from repertoire FMCG and similar. The mechanism his model describes — statistical selection among substitutable alternatives with near-zero switching cost — is a property of those categories, not a law of nature.

The reconciliation is therefore **structural, not diplomatic**: the two frames describe different buying regimes, and the question for any business is which regime it is in.

Two further points, both of which cut against the affinity thesis harder than its author will like:

- **Sharp explicitly denies the strawman.** He quotes *How Brands Grow* p.92: "Brand loyalty is part of every market." His claim is not that loyalty doesn't exist; it is that loyalty is not the *lever*, because it moves as a consequence of penetration rather than as an independent cause. An affinity thesis that argues "loyalty exists and matters" is not actually disagreeing with Sharp. To disagree you have to claim loyalty is *causally upstream* of growth — and that is the claim the evidence is weakest on.
- **The retention-economics literature that would support the affinity thesis is partly folklore.** The ubiquitous "5% increase in retention raises profits 25–95%" figure is misattributed. Reichheld & Sasser (1990, *HBR*) reported industry-specific figures topping out at **85%** (a bank branch system), 50% for an insurance brokerage, 30% for an auto-service chain. The "95%" ceiling comes from a later Bain promotional brief with no disclosed methodology. Separately, Keiningham et al. (2007, *Journal of Marketing*) found NPS does *not* outperform other satisfaction measures at predicting growth, even in Reichheld's own showcase industries. If you argue for affinity, do not lean on these numbers; the strongest critic of your position will know they are soft.

**A critical epistemic gap, reported as a gap rather than filled with speculation:** I found no independently-authored, peer-reviewed test of Double Jeopardy or the Dirichlet model in streaming, creator-economy, or persistent-world contexts. Searches surfaced only trade commentary. Whether Sharp's laws generalise to a creator economy is **an open empirical question**, not a settled one in either direction.

## 1.5 The verdict: what survives, in one bounded claim

The affinity thesis does not survive as a general theory of growth. Sharp's evidence base is stronger, and the presumption should sit with penetration, mental availability, and reach until someone shows the category is structurally different.

What survives is narrower and, for Inspiral specifically, more useful:

> **Sharp's mechanism requires substitutability. Where the product is a specific accumulated history with a specific person, substitutability is low by construction, and the Dirichlet selection mechanism that generates Double Jeopardy does not obviously apply. In that regime — and only there — depth is a real lever rather than a downstream consequence.**

An NPC that can cite `evt_mm8w2680_0001` at you, resolve it against an append-only log, and be provably right, is not a substitutable good. Your history in Tallow Ward is not portable to a competitor's world. This is a repertoire-of-one, high-switching-cost regime by construction — the regime Ehrenberg-Bass itself flags as behaving differently.

Three disciplines follow, and skipping them is how this becomes self-flattery:

1. **Reach is still the binding constraint, and the frame under-weights it.** The clip-draft pipeline (`npm run clips`) is the *reach* organ of this system, and by Sharp's logic it matters more than the memory system, not less. A world with perfect memory and eleven visitors loses to a world with mediocre memory and eleven thousand. The correct position is not "affinity over reach" — it is "reach is necessary, affinity is what makes reach non-perishable in this specific category."
2. **The manufactured-intimacy problem is sharper for AI than for human creators, and the frame doesn't mention it.** Hung et al. (2026), a PRISMA systematic review of 39 empirical studies on parasocial relationships with AI, lists five risk categories, two directly implicated here: **commercial persuasion and consumer influence**, and **privacy and data exploitation**. Multiple 2025–26 papers note the structural difference from Horton & Wohl: AI creates the *illusion of reciprocity* — it appears to respond, remember, adapt — where classical media personae could not. Inspiral is explicitly building that illusion and grounding it in a verifiable log. That is better than faking it, and it also makes the persuasive mechanism more powerful, which is a reason for more care, not less.
3. **Personalised memory is not monotonically good.** The personalisation-privacy paradox literature finds a threshold effect: personalisation builds trust up to a point, then the same mechanism reads as surveillance. An NPC citing a specific event id is on exactly this knife-edge — either "the world remembers me" or "this thing has a file on me" — and which one depends on whether the recall is *earned by something the visitor chose to do*. This lands directly in §3.3 as the `visitor_initiated` gate.

---

# Part 2 — Making the objective function real

## 2.1 The stated objective and why the product form fails

> max (Relevant Reach × Depth of Response × Conversion Probability × Future Affinity), subject to content cost, audience fatigue, and trust erosion.

Four problems, in increasing severity.

**Dimensional incoherence.** Reach is a count. Depth is undefined. Conversion Probability is a probability in [0,1]. Future Affinity is undefined. Their product has no units and no interpretable scale.

**Multiplicative annihilation.** Any zero term zeroes the objective. In a world with no commerce, Conversion Probability is *structurally* zero — Inspiral has no purchase, no subscription, no paid tier. The objective evaluates to zero for every piece of content the project will produce during the jam. Not a corner case; the modal case.

**Unbounded terms dominate.** Reach is unbounded above; the others are effectively bounded. Under maximisation, an unbounded factor multiplied by bounded factors is maximised by maximising the unbounded one. **The stated objective, taken literally, reduces to "maximise reach"** — which is Byron Sharp's position, not the author's. The rhetorical form defeats the rhetorical intent.

**Gaming surface.** Three of four terms are defined by whoever computes them. In Inspiral specifically, the model that generates the content also assigns `significance_hint`, which drives clip selection, which drives reach. The optimiser and the scorer are the same process. Not hypothetical — the current architecture.

## 2.2 Degeneracies, enumerated

| Degeneracy | Trigger | Consequence |
|---|---|---|
| Multiply-by-zero | No commerce path exists | Objective ≡ 0 for all content |
| Unbounded dominance | Reach uncapped | Objective ≈ reach-maximisation |
| Self-scoring | Host writes `significance_hint`, reads it back at every selection site | Flattery indistinguishable from significance |
| Engagement laundering | `source.ts:231` derives significance from likes/comments/views | Platform engagement becomes canon significance |
| Denominator absence | No impressions, no ad platform, no server-side click log | "Relevant Reach" has no measurable numerator or denominator |
| Fatigue as a constraint | Stated as `subject to`, never as an observable | Constraint unenforceable, so unenforced |
| Horizon collapse | "Future Affinity" has no time index | Any measurement window is arbitrary and therefore optimisable |

## 2.3 A version that can actually be computed

Design principles, each a direct response to a failure above:

- **One multiplicative gate, everything else additive.**
- **Every term bounded to [0,1] with an explicit normaliser.**
- **Explicit time index on every term.**
- **Nothing the content generator can set.** Every input must be a timestamped fact about *visitor behaviour*, not a model's opinion about its own output.
- **Report the vector, then the scalar.** The scalar orders. The vector explains. A dashboard showing only the scalar has reintroduced the original problem.

For a visitor *v* over horizon *H*:

```
A_H(v)  =  G(v)  ·  [ w_C·C_H(v) + w_R·R_H(v) + w_D·D_H(v) ]  ·  (1 − F_H(v))
```

Each of `C`, `R`, `D`, `F` ∈ [0,1]; `w_C + w_R + w_D = 1`.

| Term | Name | Meaning | Why it's not gameable by the host |
|---|---|---|---|
| `G(v)` | Participation gate | See §3.3 | Determined by wall-clock arrival timestamps |
| `C_H` | Cadence | Return frequency, and whether inter-visit gaps are shortening | Timestamps only |
| `R_H` | Grounded recall | Fraction of recall opportunities where the world cited a *visitor-initiated* event and the citation resolved, discounted for repetition | Requires a real row in `events` |
| `D_H` | Commitment depth | Magnitude *and polarisation* of stance | Stance moves clamped at ±30/tick and require a validated directive |
| `F_H` | Fatigue | Declining depth, lengthening gaps, repeated citations, hollow returns | Adversarial by construction |

Exactly one multiplicative gate because participation is genuinely a prerequisite — there is no depth of relationship with someone who came once and never returned. The other three are *substitutes* at the margin: a visitor who returns weekly but never takes a side, and one who takes an irreversible side and returns rarely, are both real forms of affinity. A product form says one of them is worth zero.

**On the four original terms:**

- *Relevant Reach* is **not computable in this system** and is dropped, not proxied. There is no impression log, no ad platform, no server-side click record. `trackedLink` (`outbound.ts:47`) embeds `?e=<event_id>&utm_source=...&utm_medium=clip` but nothing resolves it — it is a string in a markdown draft. §3.9 item 5 specifies the minimum change that makes it real.
- *Depth of Response* splits into `D_H` (what the visitor did) and `R_H` (what the world did back). Different things.
- *Conversion Probability* is **structurally unobservable** and is dropped. Not proxied, not estimated, not faked.
- *Future Affinity* becomes `C_H` — the only term for which this system has genuinely good data, because the log is append-only and timestamped.

**Horizons.** Three, reported separately: `H = 7d`, `H = 30d`, `H = ∞`. A metric with one horizon is a metric with one way to be gamed.

## 2.4 Identity resolution — the part that quietly breaks everything

`fan_id` is currently assigned from a hardcoded pool of four (`src/tick/visitors.ts`: `wren`, `ash`, `juno`, `pell`). There is no authentication, no cookie, no wallet binding, no session token. In the web and voxel surfaces a visitor's identity is whatever the connection says it is.

1. **Cross-session identity is asserted, not established.** "Remembering a visitor across visits" is currently "remembering an id the client sent us."
2. **The demo path is the only path producing identity continuity**, because it hardcodes `FAN_ID = "wren"` (`scripts/demo.ts:61`).
3. **Any real deployment needs a decision** — Telegram user id (the owner gate already uses Telegram), a signed cookie, or a wallet address. Each has a different privacy posture, and per Hung et al., "privacy and data exploitation" is a named risk of exactly this design.

**Recommendation for the jam: do not solve this. State it.** `npm run affinity` must print the identity basis as a permanent header field — `identity: asserted (fan_id from client)` — so no screenshot of the tool can be mistaken for something it isn't.

---

# Part 3 — The spec

## 3.0 Implementation status — read this first

**Added 22 August, after a second pass over the working tree.** Work was already in flight when this document landed, and it changes what is left to do. `git status` shows `src/canon/significance.ts` (new) plus modifications to `scripts/clock.ts`, `src/ip/outbound.ts`, `src/ip/source.ts`, `src/runtime/character.ts`, `tests/ip-onboard.test.ts`.

### What has landed, and lands correctly

| Built | Where | Assessment |
|---|---|---|
| `rankSignificance` / `evidenceScore` | `src/canon/significance.ts` | **Better than the §3.7 proposal in one respect** — see below |
| Re-rank wired into all three read sites | `outbound.ts:79,83,100,174,175`; `character.ts:147,153` | Exactly the fix §3.7 asks for. The `SCHEMA.md` §1 claim is now nearly true. |
| Engagement formula replaced by `consequenceScore` | `source.ts:224–290` | Retires anti-metric #5 at the source. `likes + 3×comments + views/1000` is gone; metrics are read for display only. |
| A visitor patrol on the clock | `scripts/clock.ts:57–75,158–200` | Right instinct, three defects — see D3 |

**On `rankSignificance` versus §3.7: keep theirs, feed it mine.** The band form —

```
real = clamp(hint, evidence − 0.15, evidence + 0.15)
```

— is a better treatment of the hint than the shrinkage in §3.7. It lets the host express a view inside a bounded window rather than discounting it toward a constant, and it degrades more gracefully. Adopt it. What §3.7 has that `evidenceScore` does not is the *inputs*: `evidenceScore` takes `changedState` as a **boolean**, where `event_effects.rel_movement` is a magnitude net of clamping. That distinction is not cosmetic. In `data/canon.db`, `vance↔okonkwo` is pinned at affinity −79/−81, trust 0/0, tension 100/100, so every further delta on that edge is absorbed entirely by `repo.adjustRelationship`'s clamps — and `changedState` would still be `true`, because `applyDelta` ran. **A boolean cannot see the saturated world.** The merge is small: keep `rankSignificance`'s shape, and populate `RankContext.changedState` from `event_effects` magnitude rather than from "a delta was attempted."

### Three defects, with measurements

Numbers below are from `data/canon.db` at 134 events, re-implementing `rankSignificance` exactly as written and running it over the live log.

**D1 — `RankContext` is never supplied, so the two ungameable pillars are dead.** All seven call sites pass one argument — `outbound.ts:79,83,100,174,175` and `character.ts:147,153` — and `grep -n "rankSignificance([^)]*," src/ -r` returns nothing. `ctx` defaults to `{}`, so `citedBy → 0` and `changedState → false`. The file's own docstring names EFFECT and UPTAKE as the evidence a host cannot game — and neither ever fires. What actually runs is `clamp(hint, TYPE_WEIGHT + actorBonus ± 0.15)`, which is a real improvement on the raw hint (flattery is now capped) but is a pure function of event type and actor count. Measured: a genuine confrontation with two actors scores 0.830 ctx-less, and 0.850 with `changedState` and two citations — **a 0.02 spread between "this mattered" and "nothing is known about this."** Wire the context in, or delete the two parameters so the docstring stops promising something the code does not do.

**D2 — `TYPE_WEIGHT` keys on `type`, so every `hold` inherits `arc_advanced: 0.5`.** `ACTION_EVENT_TYPE` maps `hold → arc_advanced` (`types/directive.ts:48`). Measured against the live log:

- **80 of 134 events** are `payload.action === "hold"` — a character explicitly holding their peace.
- **31 of those 80 clear 0.5**, the default `minSignificance` in `selectClips`.
- **49 of 80 clear 0.4**, the `findGrievance` bar.
- A `hold` carrying a flattering hint of 0.85 scores **0.73** — above every threshold in the system.
- Of the 75 events currently clearing the clip bar, **31 are holds**: 41% of the eligible pool is nobody doing anything.

`findGrievance` is protected by accident — `GRIEVABLE` does not contain `arc_advanced` — but `selectClips` and `showrunnerNote` have no such filter, and `NOISE` does not include `arc_advanced` either. Fix: branch on `payload.action` before the type lookup, and score `hold` at ~0.05 like the other bookkeeping. One line, and it removes 60% of the log from every selection surface.

**D2b — near-duplicate selection, which the portfolio quota in §3.5 exists to fix.** The current 24h `showrunnerNote` "WHAT HAPPENED" block resolves to three near-identical `Tomas Okonkwo confronted Sera Vance` rows followed by three near-identical `Sera Vance gave ground` rows. Across the whole log, the most frequent clip-eligible shapes are `arc_advanced [vance]` ×16, `notice_posted [vance]` ×12, `notice_posted [quill]` ×12, `confrontation [okonkwo, vance]` ×8. The arc dedupe in `selectClips:83–89` only fires when events carry an `arc_id`, and these largely do not. This is citation-repetition (anti-metric #2) expressed at the content layer rather than the memory layer, and it is the strongest practical argument for §3.5's role quota: ranking alone cannot fix it, because the duplicates are genuinely the highest-ranked things in the world.

**D3 — the patrol has the exact flaw §3.8 is about.** Four issues, in order of severity:

1. **Fixed cadence.** `patrolStep % PATROL_TICKS === 0` fires every `PATROL_TICKS` ticks, deterministically. Every inter-visit gap is identical, so `trend ≡ 0` **by construction** and `freq` is a function of the flag value. The cadence metric would be measuring the crontab. The engineer's own comment concedes the point — *"a judge reading the event log will see the regular cadence anyway"* — but concedes the wrong thing: the problem is not that it looks regular, it is that a regular schedule makes `C_H` unmeasurable rather than merely unimpressive. Fix is cheap: draw the boundary from `Exp(mean = PATROL_TICKS)` instead of using modulo, per §3.8 requirement 2.
2. **The patrollers are `wren` and `ash`** — the ids `demo.ts:61` hardcodes and `VISITOR_POOL` uses. Within days, `wren` in `data/canon.db` is a bot, demo history and patrol history are interleaved in one visitor record, and nothing in the schema says so. Rename to `sim_*` and add the `synthetic` column (§3.8 requirement 1) **before the clock runs much longer** — every hour this runs makes the record harder to disentangle.
3. **Phase 2 calls `repo.setPresence(who.id, false)` directly** instead of `visitorLeaves(ctx, who)`, so no `visitor_departed` event is written. The departure is invisible in the log, sessions never terminate, and Hold stays unmeasurable. One-line fix.
4. **Budget is fine** — credit where due. Phases 0, 1 and 3 cost an invocation and phase 2 is free; a full cycle is `PATROL_TICKS × 4 = 16` ticks at 8 ticks/day, so ≈1.5 patrol invocations/day against the ~4/day headroom (`config.ts` budget 12, minus 8 ticks). No throttle needed at the default. It **will** breach if anyone lowers `--patrol` below 2, so add the cap in §3.8 requirement 4 as a guard rather than a necessity.

### Revised build order

Items 6 and 11 of §3.10 are substantially done. What remains, in priority order: **D3.2 (rename patrollers, add `synthetic`) first** — it is the only defect that gets worse with elapsed time. Then D1, D2, D3.1, D3.3, then §3.10 items 1–5, 9, 12.

---

## 3.0.1 What canon actually contains today

Live state of `data/canon.db`, read 21 Aug 2026:

| | |
|---|---|
| World | `Tallow Ward`, started 2026-08-18T14:47:18Z |
| Events | 128 (`tick` 119, `seed` 5, `system` 4) |
| Ticks | 44; host invocations 44 (43 ok, 1 failed) |
| Cast | `vance`, `okonkwo`, `quill` |
| Arcs | `arc_kiln_debt` (escalating, **stage 26, tension 100**), `arc_almshouse_lease` (open, stage 24, tension 33) |
| Relationships | `vance↔okonkwo`: affinity **−79/−81**, trust **0/0**, tension **100/100** |
| Visitors / stances / moments | **0 / 0 / 0** |
| World facts | 28 |

Three observations that constrain everything below:

**The world has saturated.** `vance↔okonkwo` is pinned at the floor on affinity and trust and the ceiling on tension, in both directions. The clamps in `repo.adjustRelationship` are doing their job — the values are legal — but the system has run out of dynamic range. Any affinity model reading relationship values as signal will read a constant. §3.7 turns this from an invisible problem into a measured one (`event_effects.clamped`), and §3.9 item 6 fixes it.

**The event-type distribution is misleading by construction.** 77 of 128 events are `arc_advanced` — but `ACTION_EVENT_TYPE` (`src/types/directive.ts:48`) maps `hold → arc_advanced`. "Held their peace" and "advanced the storyline" are the same event type in the log. The distinguishing field is `payload.action`, written by `apply.ts:192`. **Classify on `payload.action`, never on `type` alone.**

**Three event types in the frozen vocabulary are never emitted.** `visitor_recognized` (which `greet_visitor` and `recruit_visitor` map to), `visitor_spoke`, and `visitor_gifted` have zero rows in every database. `terrain_altered` is emitted only from `voxelSurface.ts:188`.

## 3.1 The six levels, mapped onto what the system can actually see

"Observable" means: there is, or can cheaply be, a row in `events` or a derived table that constitutes evidence.

| Level | Inspiral analogue | Observable? | Evidence | What's missing |
|---|---|---|---|---|
| **Stop** | A visitor arrives at all | **Partially** | `events.type = 'visitor_arrived'` | No denominator. Nobody knows how many saw a clip and didn't come. Needs a click-resolving endpoint for `?e=<event_id>`, or nothing. **Do not proxy.** |
| **Hold** | Session duration | **Weakly** | `visitor_arrived` → `visitor_departed` interval | `visitor_departed` fires only from `visitorLeaves()` (`visitors.ts:169`) and `demo.ts:202`. A browser close emits nothing, so real sessions have no terminator. Needs an on-disconnect hook in `webSurface`/`voxelSurface`. |
| **Reward** | The world demonstrated it remembered them, provably | **Yes, but discarded** | `RenderedBehavior.cites[]` | **The highest-value signal in the system, currently computed and thrown away.** §3.2. |
| **Signal** | A costly voluntary act | **Yes** | `visitor_pledged`; `terrain_altered` with a `fan:` actor; `visitor_stance` deltas carrying a `moment` | `visitor_spoke` / `visitor_gifted` exist in the vocabulary but nothing emits them |
| **Convert** | — | **No** | — | No commerce, no subscription, no account. **Not measurable in this build. Do not fake it, do not proxy it, do not put it on a slide.** |
| **Compound** | Did they come back, and sooner | **Yes — the system's best signal** | Inter-arrival gaps from the append-only log | Only the demo path produces multi-session data today; §3.8 fixes that |

### The Reward gap, in detail

`src/runtime/character.ts` builds a `RenderedBehavior` with `cites: string[]`, documented as "Event ids this performance references. Empty means it invented nothing." Populated from three sources: a `notable_moment.event_id` the character actually witnessed (`:402`), a grievance event id (`:420`), and `relationship.last_event_id` (`:445`). `ConsoleSurface.present` prints it. `MemorySurface` collects it in memory. **Nothing persists it.** The moment the surface returns, the single fact that most distinguishes this project from every other LLM-NPC demo — *the world cited a verifiable receipt at a specific person* — is garbage-collected.

**Credit where due:** the invariant *is* tested. `tests/citing.test.ts:97` asserts `r.cites.every(id => repo.getEvent(id) !== undefined)`, and `tests/tick.test.ts:236–244` runs the full return-visit scenario (18 ticks of absence, then a return) and asserts every citation both resolves *and* predates the greeting. That is good discipline and the strongest evidence the project has. What is missing is **runtime enforcement and a runtime record**: nothing checks it in `dispatch` (`runTick.ts:63–86`) against a live host, and nothing persists the outcome. So the project can say "we test that citations resolve" but cannot say "here are the 47 citations this world has made and all 47 resolve." `recall_citations` closes that gap in about twenty lines and turns a green test into a live audit trail — materially better to show a judge.

## 3.2 New tables

All four are **derived projections**, rebuildable by replay, consistent with `SCHEMA.md` §2 ("Exists so reads are fast, not because it is authoritative"). None touches the five frozen event fields, `actors[0]`, the directive shape, the seven delta ops, or canon's authority — so none violates the §6 freeze.

Full DDL, copy-pasteable, is in **[`docs/affinity/002-affinity-tables.sql`](affinity/002-affinity-tables.sql)**. Paste it into the `DDL` template literal in `src/canon/db.ts` and bump `SCHEMA_VERSION` from `1` to `2`. Because every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, existing databases upgrade in place with no migration step and no data loss.

Summary of the four:

| Table | Purpose | Written by |
|---|---|---|
| `recall_citations` | The Reward ledger — every time the world cited a receipt at a visitor, and whether it resolved | `dispatch` in `runTick.ts` |
| `visitor_sessions` | Sessionised presence, and the hollow-return flag | `visitorArrive` / `visitorLeaves` in `visitors.ts` |
| `event_effects` | Realised (post-clamp) state movement per event — the basis of computed significance | `applyDirective` in `apply.ts` |
| `clip_drafts` | What was drafted, with what role, and whether the owner published it | `writeClips` in `outbound.ts` |

Two columns deserve a note before the code.

**`visitor_sessions.greeting_cached`.** `src/tick/visitors.ts:130–145` replays a stored greeting when the world fingerprint is unchanged, writing a `visitor_arrived` event with `significance_hint: 0.05` and the summary "*Nothing had changed since they left.*" That is a good cost optimisation and it is *also* the precise event in which a returning visitor is not recognised as having returned. It is the system's built-in hollow-recognition detector. The first-visit path in `onboardVisitor` writes `0.4`, so `significance_hint <= 0.05` identifies the cached branch uniquely and is already queryable today, before any new table exists:

```sql
SELECT COUNT(*) FROM events
WHERE type = 'visitor_arrived' AND significance_hint <= 0.05;
```

**`event_effects.clamped`.** `repo.adjustRelationship` clamps to canon ranges on write, so a requested `affinity: -25` against a relationship already at `-79` moves only 21 points and silently discards 4. Nothing records the discard. Recording it makes world saturation a measured quantity rather than something you notice by reading a table by hand — which is how it was noticed for this document.

## 3.3 The affinity model — exact definitions

All computed over horizon `H` ending at `repo.now()` (**world** time; `SCHEMA.md` §1 notes world time may run faster than wall time, so horizons are in *world* days and the tool must label them as such).

Named queries for every quantity below are in **[`docs/affinity/queries.sql`](affinity/queries.sql)**.

### Participation gate `G(v)`

Hard 0/1 gates throw away information at small n. Three-valued, and the tool prints which applied:

```
G = 1.00   sessions ≥ 2 with a gap ≥ 12h                (returned)
G = 0.50   sessions = 1 AND ≥1 Signal event              (engaged, not yet returned)
G = 0.15   sessions = 1, arrival only                    (stopped, nothing more)
```

The 12h threshold is `GAP_MS` from `character.ts:81` — the same constant that decides whether a character treats a visitor as "returning." **Import it; do not redeclare it.** The metric and the fiction must agree about what a return is, and if someone later tunes `GAP_MS` both should move together.

### Cadence `C_H(v)`

```
sessions  = visitor_sessions rows for v with started_ts in H, ordered
gaps[]    = consecutive differences of started_ts, in world-hours
expected(H) = 2 for H=7d, 6 for H=30d, max(2, floor(world_days/5)) for H=∞

freq  = min(1, len(sessions) / expected(H))

if len(gaps) >= 3:
    firstHalf  = gaps[0 .. floor(n/2))
    secondHalf = gaps[floor(n/2) .. n)
    m1 = median(firstHalf); m2 = median(secondHalf)
    trend = clamp((m1 - m2) / max(m1, 1e-9), -1, +1)
    C_H   = 0.7*freq + 0.3*(0.5 + 0.5*trend)
else:
    trend = undefined
    C_H   = freq                      # print "trend: n/a (need ≥4 sessions)"
```

`trend > 0` means gaps are shortening — the literal reading of "are they more likely to pay attention next time." With fewer than four sessions `trend` is undefined; **the tool must print `n/a`, never silently substitute 0.5.** Substituting a neutral value for a missing measurement is how a metric starts lying.

### Grounded recall `R_H(v)` — and the repetition discount

Not "how many times an NPC mentioned something," which the host inflates at will. Three gates:

```
opportunities = count of events in H where
                  payload.action ∈ {greet_visitor, recruit_visitor}
                  AND payload.target ∈ {'fan:'||v, v}

delivered     = opportunities that produced ≥1 recall_citations row
grounded      = count of recall_citations rows for v in H
                  where resolved = 1 AND visitor_initiated = 1
distinct      = count of DISTINCT cited_event_id among those rows

coverage   = delivered  / max(1, opportunities)          # did it recall at all
freshness  = distinct   / max(1, grounded)               # was it the same thing again

R_H = coverage * freshness
```

**The `freshness` factor is the repetition discount and it is the centrepiece of this design.** Worked example — a partisan visitor over eight visits, where the NPC has one dramatic pledge to cite:

| Visits | opportunities | delivered | grounded | distinct | coverage | freshness | R_H |
|---|---|---|---|---|---|---|---|
| 2 | 2 | 2 | 2 | 2 | 1.00 | 1.00 | **1.00** |
| 4 | 4 | 4 | 4 | 3 | 1.00 | 0.75 | **0.75** |
| 8 | 8 | 8 | 8 | 3 | 1.00 | 0.38 | **0.38** |
| 16 | 16 | 16 | 16 | 3 | 1.00 | 0.19 | **0.19** |

An NPC that cites the same heroic moment every visit converges to `R_H → 0`. **Citing one thing forever scores as zero recall**, which is correct: it is a catchphrase, not a memory. Note what this implies operationally — `R_H` can only be sustained by a world that keeps *generating new receipts* for that visitor, which means the world has to keep giving them things to do. That is the intended incentive.

`visitor_initiated = 1` is the second anti-flattery gate: recall counts only when the world remembers *something the visitor chose to do*, not when it recites its own plot at them. This is the operational answer to the personalisation-creepiness threshold from §1.5 — memory of your choices reads as recognition; memory of things you merely witnessed reads as a file.

**Edge cases.** `opportunities = 0` and `sessions ≥ 2` → `R_H = 0` and flag `no-recall` (a real zero: the world had chances and took none). `opportunities = 0` and `sessions = 1` → print `R n/a (no return, no opportunity)` and exclude from cohort means.

### Commitment depth `D_H(v)`

Magnitude alone is wrong. A visitor at +30 with all three characters has been agreeable, not committed. `SCHEMA.md` §2.5 states the design intent directly: *"Taking a side must cost you something with someone."* So commitment is **polarisation**.

```
s = [sentiment for each character in the cast]     # visitor_stance; absent → 0
mag = mean(|s|) / 100
pol = (max(s) - min(s)) / 200                      # one at +100 and one at -100 → 1.0
D_H = 0.4*mag + 0.6*pol
```

`pol` weighted higher than `mag` operationalises the schema's stated intent and makes the metric refuse to reward a world that likes everyone equally. **Missing `visitor_stance` rows count as 0, not as absent** — a character the visitor has no standing with is a character they have not taken a side about, which is information.

Edge case: cast size 1 → `pol` is undefined; set `D_H = mag` and flag `single-character world`.

### Fatigue `F_H(v)`

Adversarial by construction, in [0,1], subtracted:

```
f1 = hollow_return_rate = cached_greetings / max(1, returns)
f2 = depth_decay        = clamp(1 - mean(|Δstance| in last third of sessions)
                                  / max(1e-9, mean(|Δstance| in first third)), 0, 1)
f3 = citation_staleness = 1 - distinct / max(1, grounded)        # = 1 - freshness
f4 = gap_lengthening    = clamp(-trend, 0, 1)                    # 0 if trend undefined

F_H = max(f1, f2, f3, f4)
```

**`max`, not mean, deliberately.** Any single fatigue signal at 1.0 should zero the score. Averaging lets three good signals hide one catastrophic one — exactly the failure mode this whole document is about.

`f2` requires ≥3 sessions; below that set `f2 = 0` and print `depth_decay: n/a`.

### Weights, and printing them

`w_C = 0.40`, `w_R = 0.35`, `w_D = 0.25`. **Defensible rather than derived** — there is no data to fit them to, and pretending otherwise would be the same sin as `significance_hint`. **The tool prints the weights in its header on every run**, so any number it produces is reproducible and arguable. If someone later fits them to real data, the header changes and old screenshots are self-dating.

### Decay, and an answer to SCHEMA.md open question #2

`SCHEMA.md` §6 asks: *"Should visitor stance decay over time? A visitor returning after six months is greeted as warmly as one returning after a day."*

**Answer: no — and the question conflates two things that should be separated.**

- **`visitor_stance.sentiment` must not decay.** It is the derived summary of an append-only log. What you did on the fourth does not become less true in November. Decaying it would make the record and the receipt disagree, and the receipt is the product.
- **Recall *salience* should decay.** How prominently a character brings something up should fade. That is a rendering decision, not a canon mutation.

Implement as a read-time weight in `repo.recallMoments`, leaving the stored `weight` untouched:

```ts
// in recallMoments, after mapping rows to NotableMoment[]:
const HALF_LIFE_DAYS = 21;
const nowMs = Date.parse(this.now());
const salience = (m: NotableMoment) =>
  m.weight * Math.pow(2, -((nowMs - Date.parse(m.ts)) / 86_400_000) / HALF_LIFE_DAYS);
// then sort by salience DESC instead of the SQL ORDER BY weight DESC
```

Six lines, no schema change, no migration. An old grudge stays *citable* (the row is there, the id resolves) but is out-competed by anything recent — which is how memory behaves, and which makes the world feel like it has moved on rather than being stuck on the day you were last important.

This also partially defends the second flattery vector: the host sets `moment_weight` (default 0.6, `directive.ts:123`) and `recallMoments` currently sorts `ORDER BY weight DESC, id DESC`, so **the host chooses what it remembers about you.** Decay caps how long a self-assigned high weight can dominate. The full fix is §3.7.

## 3.4 `npm run affinity`

Add to `package.json` `scripts`, following the existing pattern exactly:

```json
"affinity": "node --env-file-if-exists=.env --import tsx scripts/affinity.ts"
```

New file `scripts/affinity.ts`, using the argument conventions already in `scripts/showrunner.ts` (`--fixture`, `--db`, plain `argv` indexOf parsing, `setLogLevel("warn")`, `repo.close()` at the end, `main().catch()` with `process.exit(1)`).

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--fan <id>` | — | Single-visitor report. Omit for aggregate. |
| `--db <path>` | `./data/canon.db` | As `showrunner.ts` |
| `--fixture <name>` | — | Resolves to `./data/<name>.db`, as `showrunner.ts` |
| `--window <7d\|30d\|all>` | all three | Restrict to one horizon |
| `--json` | off | Machine-readable; suppresses all human formatting |
| `--check` | off | Anti-metrics only |
| `--include-synthetic` | off | Include patrol visitors in the main table (see §3.8) |

### Exit codes

```
0  success — no anti-metric breach (or --check not passed)
1  --check passed and at least one anti-metric breached
2  insufficient data: fewer than 2 visitor rows, or the requested --fan does not exist
3  usage / IO error
```

Exit 2 rather than 0 matters: today every database returns exit 2, and that is the correct, informative answer.

### Single-visitor output

**The numbers below are illustrative layout, not results.** No world in this repo has a visitor row (§3.0), so every figure here is a shape to implement against, not data to quote. On camera, read whatever the tool actually prints.

```
AFFINITY — Tallow Ward
world time 2026-08-24T09:00:00Z   ·   identity: asserted (fan_id from client)
weights w_C=0.40 w_R=0.35 w_D=0.25   ·   half-life 21d   ·   gap threshold 12h (GAP_MS)

fan:wren  (Wren)   real   first seen day 2   ·   4 sessions   ·   gate 1.00 (returned)

  LADDER                observed                                     source
  Stop     ✓ 4          arrivals; 2 carried a referrer event id      events.visitor_arrived
  Hold     ~ 11m avg    3 of 4 sessions terminated                   visitor_sessions
  Reward   ✓ 4/4        4 grounded citations, 3 distinct receipts     recall_citations
  Signal   ✓ 2          1 pledge, 1 terrain edit                      events
  Convert  — n/a        no commerce path exists in this build         —
  Compound ✓ +0.31      gaps shortening: 96h → 71h → 52h              visitor_sessions

  COMPONENTS
    C  cadence          0.78    4 sessions in 30d, trend +0.31
    R  grounded recall  0.75    coverage 1.00 × freshness 0.75
    D  commitment       0.61    mag 0.29, polarisation 0.82
                                okonkwo +58, vance −34, quill +5
    F  fatigue          0.25    max(hollow 0.00, decay 0.08, stale 0.25, gaps 0.00)

  AFFINITY   A₇  0.58    A₃₀  0.53    A∞  0.53

  RECEIPTS THE WORLD HAS CITED AT THEM
    evt_mn2k1x40_0007  okonkwo  ×2  "You picked a side in front of witnesses."  ✓ resolves
    evt_mn4p7c11_0003  okonkwo  ×1  the levy Vance posted while they were gone  ✓ resolves
    evt_mn6r0d92_0012  quill    ×1  the almshouse lease, at second hand         ✓ resolves
```

Note the `×2` in the receipts block. Showing the repetition count next to each receipt is what makes `freshness` legible rather than a number the reader has to trust — the row that repeated is visibly the one dragging `R` down.

### Aggregate output

**Again: layout, not results.**

```
AFFINITY — Tallow Ward   ·   4 real + 4 synthetic visitors   ·   30d window
weights w_C=0.40 w_R=0.35 w_D=0.25   ·   identity: asserted

  REAL VISITORS
  fan       sessions  gate   C     R     D     F     A₃₀   flags
  wren        4       1.00   0.78  0.75  0.61  0.25  0.53
  ash         2       1.00   0.41  0.00  0.44  0.50  0.13  no-recall, hollow-return
  juno        1       0.50   0.17   n/a  0.30  0.00  0.06  never-returned
  pell        1       0.15   0.17   n/a  0.00  0.00  0.01  arrival-only

  SYNTHETIC (patrol — instrumentation, not evidence; see docs §3.8)
  sim_partisan  9     1.00   0.71  0.34  0.79  0.66  0.19
  sim_drifter   7     1.00   0.66  0.52  0.21  0.48  0.24
  sim_lurker    6     1.00   0.63  0.00  0.00  0.33  0.17  no-recall
  sim_provoker  8     1.00   0.69  0.41  0.74  0.59  0.24

  COHORT (real only)
    returned at least once      2/4   (50%)
    received a grounded recall  1/4   (25%)
    took a side that cost them  1/4   (25%)
    median gap, visit 1→2       96h

  ANTI-METRICS
    ⚠  hollow returns          33%    threshold 25%
    ⚠  flattery drift          1.00   threshold 0.80  — every stance move ever recorded is positive
    ⚠  clamp absorption        0.31   threshold 0.20  — the world is running out of range
    ok citation repetition     0.25   threshold 0.40
    ok unresolvable citations  0      threshold 0
    ok significance inflation  0.52   threshold 0.65
    ⚠  arc runaway             stage 26 on arc_kiln_debt, threshold 15

  n = 4 real visitors. This is a demo population, not a sample. Do not generalise.
```

That last line is not decoration. **Print it unconditionally whenever real `n < 30`.** It is the difference between a credible tool and a fabricated one.

### `--json` schema

```jsonc
{
  "world": "Tallow Ward",
  "now": "2026-08-24T09:00:00.000Z",
  "identity_basis": "asserted",
  "weights": { "c": 0.40, "r": 0.35, "d": 0.25 },
  "half_life_days": 21,
  "gap_threshold_hours": 12,
  "visitors": [{
    "fan_id": "wren",
    "synthetic": false,
    "profile": null,                      // patrol profile, or null
    "sessions": 4,
    "gate": 1.0,
    "gate_reason": "returned",
    "ladder": {
      "stop": { "arrivals": 4, "with_referrer": 2 },
      "hold": { "terminated": 3, "mean_seconds": 660 },
      "reward": { "opportunities": 4, "delivered": 4, "grounded": 4, "distinct": 3 },
      "signal": { "pledges": 1, "terrain": 1, "gifts": 0 },
      "convert": null,                    // always null; there is no commerce path
      "compound": { "gaps_hours": [96, 71, 52], "trend": 0.31 }
    },
    "components": { "c": 0.78, "r": 0.75, "d": 0.61, "f": 0.25 },
    "affinity": { "7d": 0.58, "30d": 0.53, "all": 0.53 },
    "flags": []
  }],
  "anti_metrics": [
    { "name": "hollow_return_rate", "value": 0.33, "threshold": 0.25, "breached": true }
  ],
  "n_real": 4,
  "n_synthetic": 4,
  "sufficient": false                     // n_real >= 30
}
```

`"convert": null` is deliberate and must stay null. A field that is structurally unmeasurable should be visibly null in the data, not absent — absence invites someone to fill it in later.

## 3.5 Content roles on the outbound clip drafts

### The typed field

`SCHEMA.md` §6 leaves `payload` loose by design ("`payload` is loose by design"), so a role rides in payload without touching the frozen five fields or requiring a migration.

Add to `src/types/directive.ts`:

```ts
export const ContentRole = z.enum([
  "reach",      // spectacle. legible with zero context.
  "value",      // teaches something about how the world works
  "identity",   // forces "which side am I on"
  "trust",      // the world honouring a consequence it incurred
  "conversion", // an open door: something a visitor could join
  "community",  // a visitor is visible in it
]);
export type ContentRole = z.infer<typeof ContentRole>;

// add to the Directive object:
role: ContentRole.nullable().default(null),
```

Forward it in `apply.ts:192` alongside the existing `payload.action` / `payload.arc_id` / `payload.target`. One line. Also add `role` to the JSON shape in `src/host/prompt.ts:32` so the Mind can set it — but **treat a host-set role as advisory only** and fall back to derivation whenever the two disagree, for the same reason `significance_hint` is being demoted.

### Derivation for the 128 events that predate the field

Derive from `payload.action`, **not from `type`** (§3.0: `hold` and `arc_advance` share a type):

```ts
export function roleOf(e: WorldEvent): ContentRole | null {
  const action = e.payload.action as string | undefined;
  const hasFan = e.actors.some(a => a.startsWith("fan:"));

  if (hasFan)                                              return "community";
  if (e.type === "arc_resolved" || action === "concede")   return "trust";
  if (action === "offer_alliance" || action === "accept_alliance"
      || action === "break_alliance" || action === "snub") return "identity";
  if (action === "post_notice")                            return "value";
  if (e.type === "arc_opened")                             return "conversion";
  if (action === "confront" || action === "sabotage")      return "reach";
  return null;   // hold, system events, seed — never clipped
}
```

Each mapping is an argument:

- **trust ← `arc_resolved` / `concede`.** Trust in a fiction is demonstrated by the world *paying a cost it incurred*. A resolving arc is the world honouring its own escalation; a concession is a character losing something. Nothing else in the vocabulary demonstrates credibility, because credibility is only visible when it is expensive.
- **identity ← alliance and snub actions.** These make a viewer take a side. `snub` in particular is the cheapest identity content in the vocabulary: someone is publicly excluded and the viewer immediately knows whether they think that was fair.
- **conversion ← `arc_opened`.** In a world with no commerce the conversion analogue is an *open door* — a storyline a visitor could walk into and affect. A resolved arc is a closed door.
- **community ← any event with a `fan:` actor.** The role this project can produce and almost nobody else can: a clip about a real person's real choice, with a resolvable receipt. **See §3.8 for why synthetic visitors must be excluded from this.**
- **`hold` → null, therefore never clipped.** Given `hold` is ~60% of the current log, this is load-bearing.

### Selection logic

Current: `selectClips` (`outbound.ts:66`) filters `significance_hint >= minSig` (`:76`), sorts by `significance_hint` then recency (`:80`), dedupes by `arc_id` (`:83–89`). Two changes.

**1. Portfolio quota instead of pure ranking.** The frame's strongest operational claim is that the account, not the post, is the compounding unit — "the mistake is asking every post to maximise every metric." That translates into a *quota over a window*, not a score on an item:

```ts
export interface RolePolicy { role: ContentRole; min: number; max: number; }

export const DEFAULT_POLICY: RolePolicy[] = [
  { role: "reach",      min: 1, max: 3 },
  { role: "value",      min: 1, max: 3 },
  { role: "identity",   min: 1, max: 2 },
  { role: "trust",      min: 1, max: 2 },
  { role: "conversion", min: 1, max: 1 },
  { role: "community",  min: 0, max: 2 },
];
```

Fill algorithm, over a rolling 7-day window of `clip_drafts`:

```
1. bucket candidate events by roleOf(); drop nulls
2. count already-drafted-in-window per role from clip_drafts
3. deficit(role) = max(0, policy.min - drafted_in_window(role))
4. while slots remain and any deficit > 0:
       pick the role with the largest deficit (ties → lowest drafted count)
       take its best-ranked unused candidate (ranking below)
       if that role has no candidates, zero its deficit and continue
5. fill remaining slots by global rank, skipping any role at its max
6. keep the existing arc dedupe throughout
```

Step 4's "if that role has no candidates, zero its deficit" matters: a quiet world may genuinely have no `trust` events this week, and the selector must degrade to fewer clips rather than loop or pad with junk.

**2. Rank within role on evidence, not on the host's opinion.** `significance_hint` stays only as a final tiebreak. Ordered keys:

```
a. computed significance  (§3.7)                     DESC
b. is it a resolvable receipt: cited in recall_citations   DESC
c. does it involve a real visitor's real choice
     (fan: in actors AND visitors.synthetic = 0)     DESC
d. recency                                           DESC
e. significance_hint                                 DESC   ← tiebreak only
```

**3. Persist drafts.** `writeClips` writes a markdown file and forgets. `clip_drafts` makes role-mix measurable across runs and gives the owner somewhere to mark what they actually posted. Without it the portfolio constraint cannot be checked at all, because there is no record of the window.

## 3.6 What the world should do differently

### Does an NPC behave differently toward a first-time versus a fifth-time visitor?

**Today: barely, and in the wrong direction.** `sliceFor` (`character.ts:166–229`) computes `isNew`, `returning`, and `awayHours`. `renderBehavior` branches on `ally = stance >= 20` (`:373`) and `hostile = stance <= -20` (`:374`), crossed with `returning` — six branches at `:382–388`. `awayHours` is used, but only to phrase the duration ("a day" / "3 days", `:410–412`), never to vary *what* is disclosed. So the state space is `{ally, hostile, neutral} × {returning, not}` and **visit count appears nowhere.** Worse, the fifth visit is *more* likely to be a cached replay (`visitors.ts:130–145`), because after enough ticks the world fingerprint stabilises. **The current architecture makes the fifth visit cheaper and emptier than the second** — precisely inverted relative to the thesis.

Four changes, in order of value.

**(a) Vary what is *disclosed*, not how warmly.** Warmth is the flattery failure mode and, per the personalisation-threshold literature, also the creepiness failure mode — an NPC disproportionately delighted to see you reads as needy, not familiar. Familiarity in fiction is expressed through information asymmetry. Add a disclosure tier to `CanonSlice.visitor`:

```ts
// in sliceFor, after computing `returning` and stance:
const visits = v.interactions.filter(i => i.kind === "arrival").length;
const stanceMag = Math.abs(v.stance[d.actor] ?? 0);
const tier =
  !returning              ? 0 :
  visits <= 2             ? 1 :
  visits <= 4             ? 2 :
  stanceMag >= 40         ? 3 : 2;
```

| Tier | Condition | What the character may draw on |
|---|---|---|
| 0 | first visit | public facts only — `world_facts`, open arc titles |
| 1 | returning, ≤2 visits | + a grievance, framed as the character's public position |
| 2 | returning, 3–4 visits | + `relationships.note` — the *why* behind the grievance |
| 3 | returning, ≥5 visits **and** \|stance\| ≥ 40 | + the character volunteers something that costs them: a taboo brushed against, a goal admitted |

Tier 3 gates on stance magnitude as well as visit count, so disclosure is earned by commitment rather than attendance. This is `sliceFor` computing one integer and `renderBehavior` branching on it. It is the difference between "the world remembers you" and "the world trusts you," which are different products.

**(b) Let a returning visitor be told they were *wrong*.** The only negative path today is `stance <= -20` → hostile. There is no path where a character the visitor sided *with* tells them their support cost something. That is the world's most important missing behaviour, because a world that never contradicts you is a world with nothing at stake. Concretely: when `arc_resolve` fires against an arc a visitor pledged into, the character they backed should be able to say so, citing the pledge event id. The data is already there — the pledge is in `visitor_moments` with `witnesses` set. This is also the only mechanism that will ever move `flattery drift` (anti-metric #3) off 1.00.

**(c) Kill the empty-return path; don't optimise it.** The cached greeting saves an invocation when the world hasn't moved. But if the world hasn't moved since a visitor left, the correct behaviour is not to replay — it is to *say so*, in character: *"Nothing has changed. That is the problem."* A quiet world acknowledged as quiet is honest and costs **zero** invocations, because the deterministic openers in `character.ts` can render it. A replayed greeting is a lie about attention. One branch in `visitors.ts:130`, and it converts the system's largest hollow-recognition source into characterisation. Keep writing `greeting_cached = 1` either way, so the metric still sees it.

**(d) Fix the saturation.** `vance↔okonkwo` sits at affinity −79/−81, trust 0/0, tension 100/100. There is nowhere left for a visitor's choice to move anything. A world where nothing you do changes the state cannot reward you, whatever it says. Cheapest fix: a forcing function in `applyDelta`'s `arc_advance` case — when `arc.stage > 15` and `tension >= 90`, the digest must mark the arc `must_resolve` and the tick prompt must ask for a resolution. `arc_kiln_debt` is at stage 26 with no end in sight, and an arc that can never end is not a storyline.

### What is the world's equivalent of "Reward"?

Not being greeted. Not being flattered. **Being cited accurately about something you chose to do, in a way you did not expect and could check.**

Three properties, each separately measured, each corresponding to a factor in `R_H`:

1. **Grounded** — the citation resolves against the log (`resolved = 1`).
2. **Yours** — the cited event has you in `actors` (`visitor_initiated = 1`).
3. **New** — it is not the thing you were told last time (the `freshness` factor).

Fail any one and the recall is a catchphrase. This is why `R_H` has exactly those three gates: **the metric *is* the definition of Reward rather than a proxy for it.** Most engagement metrics are proxies; this one isn't, because the thing being measured is itself a database row.

### What does trust erosion look like here, and can the system detect it?

Trust erodes through **contradiction between the record and the performance**. Four detectable forms:

| Erosion | Detector | Cost |
|---|---|---|
| Citing an event that doesn't exist | `recall_citations.resolved = 0` | Free once the table exists |
| Citing an event the character didn't witness | Compare `cited_event.actors` against `character_id`. `recallMoments` already filters on `witnesses`, but `findGrievance` only requires the character be *present*, not harmed | Cheap |
| Contradicting a `world_fact` | 28 facts exist and nothing checks them. `SCHEMA.md` §6 open question 4 notes the `qc` alias "is wired but unused" | Moderate — one host call |
| Remembering only flattering things | Signed vs absolute stance drift — anti-metric #3 | Free |

## 3.7 Significance, redefined

> **Partly built already.** `src/canon/significance.ts` implements `rankSignificance` and it is wired into all three read sites; `source.ts` has replaced the engagement formula with `consequenceScore`. **Adopt the band form `clamp(hint, evidence ± 0.15)` in preference to the shrinkage proposed below** — it is the better treatment of the hint. What this section still contributes is the *inputs*: realised, post-clamp state movement instead of a boolean. See §3.0 for the merge, and D1 for why the existing `RankContext` never fires.

This section exists because two things in the current code need replacing and the replacement needs an actual definition before anyone can implement it.

### What is wrong now

1. `significance_hint` is **written by the host** and read raw at every selection site (`outbound.ts:76,80,171,172`; `character.ts:144,150`; `bible.ts:124`; `onboard.ts:44`). `SCHEMA.md` §1 and `types/events.ts:81` promise a re-rank on read that does not exist.
2. For ingested events it is **derived from platform engagement**: `source.ts:231–247` computes `engagement = likes + 3×comments + views/1000` then `significance = min(0.95, 0.25 + log₁₀(1+engagement)/8)`.

The second is the sharper problem. It means a creator's most-liked post becomes their world's most significant canon, which is the exact substitution this project exists to argue against. It is also a *good faith* piece of code — the log scaling comment ("so one viral video does not make everything else invisible") shows someone already worried about it. The fix is not to scale engagement better; it is to stop using it as the primary key.

### What significance should be computed from

**Narrative consequence: how much irreversible, verifiable state this event actually moved.** Four measurable components, none settable by the host, all recomputable by replay.

**1. Realised state movement.** Not what the delta *requested* — what survived the clamp. `repo.adjustRelationship` returns the new `Relationship`; capture the before/after difference in `applyDelta` and write it to `event_effects`:

```ts
// in applyDelta, case "relationship_delta":
const before = repo.getRelationship(delta.from_id, delta.to_id);
const after  = repo.adjustRelationship(delta.from_id, delta.to_id, {...}, event.event_id);
const b = before ?? { affinity: 0, trust: 50, tension: 0 };
const realised =
    Math.abs(after.affinity - b.affinity)
  + Math.abs(after.trust    - b.trust)
  + Math.abs(after.tension  - b.tension);
const requested =
  Math.abs(delta.affinity) + Math.abs(delta.trust) + Math.abs(delta.tension);
// accumulate onto event_effects: rel_movement += realised,
//                                clamped     += (requested - realised)
```

Same pattern for `visitor_stance` via `adjustStance`, which already returns the clamped result.

**2. Arc transition.** A step change in the storyline, not a stage counter increment:

```
arc_resolved                          1.00
arc_opened                            0.60
status crossed open → escalating      0.70   (tension crossed 70 this event)
stage advanced, no status change      0.10
hold / no arc effect                  0.00
```

The 0.10 for a bare stage advance is what stops the current log's 77 `arc_advanced` rows from looking like 77 significant events.

**3. Irreversibility.** Some things cannot be walked back:

```
arc_resolved                 1.00
alliance_broken              0.80
visitor_pledged              0.70
concession                   0.50
everything else              0.00
```

**4. Revealed significance — citation count.** An event a character later chose to cite *is* significant, by revealed preference, and no model wrote that number:

```
cite_score = min(1, COUNT(recall_citations WHERE cited_event_id = e) / 3)
```

This is retroactive: an event's significance can rise weeks later when someone brings it up. That is a feature. It is also the one component that cannot be gamed by the host at write time, because it depends on a future decision made under different conditions.

### The formula

```
sig(e) = clamp(
    0.30 · min(1, event_effects.rel_movement    / 60)
  + 0.20 · min(1, event_effects.stance_movement / 60)
  + 0.25 · arc_transition_score
  + 0.15 · irreversibility
  + 0.10 · cite_score
  , 0, 1)
```

Normalisers: 60 is roughly two maximum-size relationship deltas (the per-tick clamp is ±25 affinity / ±25 trust / ±30 tension) — an event that moves 60 points of realised relationship state is a big event. 60 for stance likewise (clamp is ±30, so two maximal moves).

**Where `significance_hint` goes.** It becomes a **prior, used only when computed significance is unavailable** — i.e. for the 128 existing events with no `event_effects` row, and for events whose effects are genuinely unmeasurable (`world_fact`, `character_mood`). Blend:

```
significance(e) = event_effects exists ? sig(e)
                                       : 0.5 * significance_hint + 0.5 * 0.35
```

The 0.35 pull-toward-baseline is a deliberate shrinkage: an unverified host claim of 0.95 lands at 0.65, not 0.95. Optimistic self-assessment survives, discounted, rather than being either trusted or discarded.

**Where it goes for ingested events.** `normalizeItem`'s engagement formula should be **demoted to a tiebreak within the onboarding ranking only** (`onboard.ts:44`, `bible.ts:124`), where there is genuinely nothing else to rank by — a back catalogue has no realised state movement yet, because the world doesn't exist. It must not survive into `events.significance_hint` as a primary key. Concretely: keep the computation, rename the field to `source_engagement` so it is never mistaken for significance, and set the ingested event's `significance_hint` from the item's *stated* significance if present, otherwise a flat 0.4. Then `sig(e)` takes over the moment the event has effects.

Implementation note: `sig()` is a pure function of two derived tables and should live in a new `src/canon/significance.ts` with no repo writes, so it can be unit-tested against fixtures and recomputed at will. Do **not** materialise it into a column — a stored significance is a significance someone will eventually write to.

## 3.8 The synthetic visitor patrol

> **A patrol already exists** in `scripts/clock.ts:57–75,158–200`, added in the in-flight work assessed in §3.0. Read this section as a review of it, not a greenfield design. Its budget handling is right; its cadence, identity tagging and departure path are the three things to change (§3.0, D3).

The premise is right: with zero visitor rows, nothing downstream can be validated. But a bot on a timer is the single easiest way to manufacture a flattering curve, so the patrol has to be designed as **instrumentation, not evidence** — and the design has to make the difference visible in the data rather than in a caveat somebody forgets.

The framing that makes this honest: **the patrol is a control arm, not a treatment arm.** §4's overclaiming section notes that the project has no counterfactual — no world where the NPC forgets — so "returning visitors come back more" is unfalsifiable. A patrol with a *known, memoryless* schedule supplies the null distribution: it is what the metric reads when there is no affinity, because a Poisson process has no affinity. If a real visitor's curve is indistinguishable from the patrol's, the metric found nothing. That is a much better thing to have built than more data.

### Hard requirements

**1. Tag them, in the schema, permanently.**

```sql
ALTER TABLE visitors ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visitors ADD COLUMN profile   TEXT;   -- patrol profile, NULL for real
```

(Both are in `002-affinity-tables.sql`, guarded so re-running is safe.) Use `fan_id` values prefixed `sim_` as well — belt and braces, and it makes raw `sqlite3` inspection unambiguous. **Do not reuse `wren`/`ash`/`juno`/`pell`**; `demo.ts:61` hardcodes `wren` and mixing demo and patrol history in one record makes both worthless.

Everything downstream must respect the tag:

- `npm run affinity` — separate table, never merged into cohort statistics, `--include-synthetic` off by default.
- `selectClips` — **synthetic visitors are excluded from the `community` role entirely.** An owner must never be handed a clip draft about a bot; that is the pipeline generating fake social proof, which is the worst possible failure of this project.
- `showrunnerNote`'s VISITORS block (`outbound.ts:180–190`) — label them `(patrol)` or omit.
- The digest handed to the Mind (`digest.ts`) — **include them normally.** The world should not know which of its visitors are synthetic; that is the whole point of a control arm. Only the *reporting* layer distinguishes.

**2. Draw gaps from a memoryless distribution, never a fixed interval.**

A fixed interval is fatal, and specifically: with constant gaps, `trend ≡ 0` by construction and `freq` is a deterministic function of the crontab. **The cadence metric would be measuring the scheduler.** Use:

```
gap ~ Exponential(mean = 6h),  floored at 45min,  capped at 60h
```

Exponential because it is memoryless — the maximum-entropy choice given only a mean. Any structure the metric then reports in the trend term is either real or a bug, and both are worth knowing.

**3. Schedule independently of the tick.** Never trigger a patrol arrival from tick completion, and never phase-lock the two timers. The patrol runs on its own `setTimeout` chain in `scripts/clock.ts`, re-armed with a fresh draw after each visit. Coupling the schedules would drive the hollow-return rate to zero artificially — see the falsification test below, which depends on the schedules being independent.

**4. Respect the invocation budget, with a reserve for ticks.**

This is the constraint that will bite within an hour. `config.ts` defaults `dailyHostBudget` to **12**. `scripts/clock.ts` ticks every 180 min = **8/day**. The clock's own header comment says the remaining ~4 is "headroom under the ~12/day budget for visitors who turn up." So **the patrol's entire daily allowance is about 4 host-costing visits, across all profiles combined.**

`budgetExceeded` counts *all* invocations, so an unthrottled patrol will starve the ticks and the world will stop moving — which would be a self-inflicted wound with six days to the deadline. Gate patrol arrivals on a separate, directly queryable cap:

```sql
-- patrol visits that cost an invocation, trailing 24h
SELECT COUNT(*) FROM host_invocations
WHERE kind IN ('onboard','fan-event') AND ts >= datetime('now','-1 day');
```

```
PATROL_DAILY_INVOCATIONS = 3     -- of the ~4 headroom; leaves 1 for a real visitor
```

If the cap is hit, **the patrol still visits** — it just takes the free path. Which brings us to the most useful property of the design:

**5. Free visits are the point, not a compromise.** A return to an unchanged world hits the cached-greeting branch (`visitors.ts:130`) and costs **zero** invocations. So the patrol can visit far more often than the budget allows, and the cheap visits are exactly the ones that generate hollow-return data. Over six days at a 6h mean gap, four profiles produce roughly 96 arrivals, of which ~18 cost an invocation (3/day × 6) and the rest are free. That is a real dataset from a shoestring budget.

### Profiles: should it take sides?

Yes — but stochastically, and as a *set* of contrasting behaviours, because one behaviour produces one curve and one curve validates nothing. Four profiles, mapping onto the four-visitor pool size the code already assumes:

| Profile | Behaviour | What it validates |
|---|---|---|
| `sim_partisan` | Pledges to the same character every time, high stance magnitude | `D_H` polarisation; **and the repetition discount** — its `R_H` must decline |
| `sim_drifter` | Pledges to a different character each time, drawn uniformly | Whether the world reacts to inconsistency; `D_H` should stay low because stances cancel |
| `sim_lurker` | Arrives and departs, never pledges | Stop/Hold-only path; the `G = 0.15` / `G = 0.50` gates; `R_H = 0` with `no-recall` |
| `sim_provoker` | Pledges against whichever character currently has the highest outgoing tension | Whether siding with the losing party produces different recall; stress-tests `findGrievance` |

Pledge probability per visit: `partisan` 0.5, `drifter` 0.5, `provoker` 0.6, `lurker` 0.0 — and only when the budget gate allows, since a pledge goes through `visitorAction` and costs an invocation. Sessions terminate via `visitorLeaves` after a drawn dwell of `Uniform(2, 20)` minutes, so `Hold` gets a distribution rather than a constant.

### What makes the resulting curve honest — five falsification tests

Each is a prediction the design makes in advance. **Run them; a patrol that passes none of them is decoration.** `npm run affinity --check` should compute all five when synthetic visitors exist.

**T1 — Null conformance on trend.** Exponential gaps are memoryless, so patrol `trend` must be **centred on 0** with sampling noise. If patrol visitors show systematically positive trend, either the metric has a bug or the schedulers are coupled. *This is the test that makes a real visitor's positive trend mean something*, because it establishes what zero looks like.

**T2 — Profile separation.** `D_H(sim_partisan) > D_H(sim_drifter) > D_H(sim_lurker) ≈ 0` must hold, by construction. If all four profiles score alike, `D_H` has no discriminating power and is worthless. This is a unit test for the metric, using the patrol as a fixture.

**T3 — Repetition decay.** `R_H(sim_partisan)` must **decline monotonically-ish** as visits accumulate, because a partisan generates few distinct receipts and the world keeps citing the same pledge. Concretely: `R_H` at 8 visits should be roughly half its value at 4 (see the worked table in §3.3). **If a patrol visitor's `R_H` stays flat or rises across 8+ visits, the repetition discount is not working and §3.3 is broken.** This is the single most important test in the list, because `freshness` is the design's centrepiece and this is the only way to know it fires.

**T4 — Hollow-return floor.** With independent schedules, `f₁` must be **materially above zero**. It is computable in advance. For gaps drawn from `Exp(λ)` and ticks at fixed interval `T`, treating arrival phase as uniform, the probability a gap contains no tick is `max(0, 1 − g/T)` for `g ≤ T`:

```
P(cached) ≈ ∫₀^T (1 − g/T)·λe^{−λg} dg
```

With `T = 3h` and mean gap 6h (`λ = 1/6`), this evaluates to **≈ 0.21**. So expect roughly one cached greeting in five. Materially below 0.21 means the schedulers are coupled (or `visitorAction` is invalidating the fingerprint more than expected); materially above means ticks are failing and the world isn't moving. Either way the number is diagnostic, and it is diagnostic *because it was predicted before the data existed*. (The estimate ignores stance-change invalidation, which pushes the true rate slightly lower — treat 0.21 as a ceiling.)

**T5 — Clamp absorption.** If `event_effects.clamped / (realised + clamped)` climbs above 0.20, the patrol is pledging into a saturated world (§3.0: four values already pinned) and every stance move it appears to make is fictional. **Under this condition all patrol affinity numbers are void** and the tool should say so rather than print them.

### What the patrol must never be used for

Never quote patrol-derived affinity as evidence for the thesis. Never let a patrol visitor appear in a clip draft. Never show the aggregate table on camera without the synthetic block visibly separated and labelled. If asked on camera what the patrol is: *"synthetic visitors on a random schedule — they're the control, they tell us what the metric reads when there's no relationship there."* That is both true and a better answer than pretending there are real users.

## 3.9 Anti-metrics

Metrics that should make the project *less* confident when they move. `npm run affinity --check` computes all eight and exits 1 on any breach.

| # | Anti-metric | Computation | Threshold | What a breach means |
|---|---|---|---|---|
| 1 | **Hollow return rate** | cached greetings / returns | > 0.25 | The world isn't noticing people who come back. Currently the *only* return path for a stable world. Note the tension with T4 — for synthetic visitors ~0.21 is expected and healthy; for real visitors it is a defect. Compute the two populations separately. |
| 2 | **Citation repetition** | `1 − distinct / grounded` per visitor | > 0.40 | The NPC has a catchphrase, not a memory |
| 3 | **Flattery drift** | `\|Σ sentiment\| / Σ \|sentiment\|` across all stances | > 0.80 | Nothing anyone does ever costs them anything. A world of pure upside has no stakes. Only §3.6(b) will ever move this. |
| 4 | **Significance inflation** | mean `significance_hint` on `tick`-source events, trended | rising, or mean > 0.65 | The host is grading its own homework |
| 5 | **Engagement laundering** | share of ingested events whose significance came from `normalizeItem`'s engagement formula rather than a stated value | > 0.50 | Platform engagement has become canon significance — the precise thing the thesis argues against. §3.7 retires this. |
| 6 | **Unresolvable citations** | `recall_citations.resolved = 0` count | > 0 | **Existential.** Every claim the project makes is false if this is non-zero. |
| 7 | **Arc runaway** | `max(arcs.stage)` where `status != 'resolved'` | > 15 | The world has run out of dynamic range. **Currently breached: stage 26.** |
| 8 | **Clamp absorption** | `Σ clamped / Σ (realised + clamped)` | > 0.20 | Deltas are being silently eaten. **Currently unmeasurable; will likely breach on first measurement** given four pinned values. |

Two of these — 5 and 7 — are **already breached in the live database**, and 4 and 8 are unmeasurable-because-unmitigated. Reporting that honestly is more persuasive than a clean dashboard, because a clean dashboard on `n = 0` visitors is obviously decorative.

There is a temptation to define a single number for "memory that flatters rather than informs." **Resist it.** It decomposes into flattery drift (#3), citation repetition (#2), and the `visitor_initiated` gate inside `R_H` — individually actionable, and a composite would let two hide behind the third. Same argument as `max` rather than `mean` in `F_H`.

## 3.10 Build order

| # | Change | Files | Lines | Why |
|---|---|---|---|---|
| 1 | Four tables + `visitors.synthetic/profile` | `db.ts` (paste `002-affinity-tables.sql`), `SCHEMA_VERSION → 2` | ~70 | Everything else depends on it |
| 2 | Persist `recall_citations` in `dispatch` | `runTick.ts:63–86` | ~20 | Turns a green unit test into a live audit trail; unlocks Reward |
| 3 | `event_effects` capture in `applyDelta` | `apply.ts` | ~25 | Unlocks computed significance and clamp absorption |
| 4 | Say "nothing has changed" instead of replaying | `visitors.ts:130` | ~6 | Removes the largest hollow-recognition source |
| 5 | `visitor_sessions` + close on socket disconnect | `visitors.ts`, `webSurface.ts`, `voxelSurface.ts` | ~30 | Makes Stop and Hold observable |
| 6 | `src/canon/significance.ts` + demote `significance_hint` at read sites | new, `outbound.ts`, `character.ts` | ~60 | §3.7; makes true a claim `SCHEMA.md` §1 already makes |
| 7 | Recall-salience decay in `recallMoments` | `repo.ts` | ~6 | Answers SCHEMA open question 2 |
| 8 | Arc resolution forcing function | `apply.ts`, `digest.ts` | ~15 | Unpins the saturated world |
| 9 | `scripts/affinity.ts` | new | ~280 | The deliverable |
| 10 | Patrol in `scripts/clock.ts` | `clock.ts`, new `src/tick/patrol.ts` | ~120 | §3.8 — start this early; it needs days of wall time to produce anything |
| 11 | `role` on directives + `roleOf()` + portfolio quota | `directive.ts`, `apply.ts`, `outbound.ts` | ~90 | §3.5 |
| 12 | Disclosure tiers in `sliceFor` | `character.ts` | ~25 | First-visit vs fifth-visit behaviour |

**Sequencing note:** item 10 is listed tenth by dependency but should be *started* as soon as items 1, 2 and 5 land. It is the only item whose output is a function of elapsed wall-clock time, and there are six days left. Everything else can be built in an afternoon; the patrol cannot be caught up.

Items 2, 3, 4 and 7 are under an hour combined and change what the project can honestly claim. Items 4 and 8 change the *fiction*, not just the measurement, and are the ones most likely to be noticed by a judge who plays the demo twice.

---

# Part 4 — The submission argument

## What to say on camera

> "Platforms measure whether someone stopped scrolling, because a stop is inventory they can sell. A creator needs to know something else: after seeing this, did the right people move closer — and are they more willing to hear from us next time. Inspiral makes that measurable, because the world writes an append-only log: when an NPC greets a returning visitor as an ally it cites the event id of the thing they actually did, and `npm run affinity` reads the ladder straight out of canon — arrivals, what the world cited back, whether every receipt resolves, and whether the gap between visits is getting shorter. It also reports when the world is faking it, and on this run it caught us: [read the actual anti-metric line the tool prints]."

Three sentences, all defensible, all backed by a command you can run live. The self-incriminating clause is the strongest part — it demonstrates the measurement apparatus is real by showing it catching the project.

**One warning about that last clause.** Do not rehearse a specific number. With zero real visitor rows today (§3.0), any figure quoted before the tool actually runs is invented. Run it, read the line, say that. If nothing breached, say *that* — "it found nothing this run, here's what it would have caught" — and show the `--check` thresholds. An empty result honestly reported is stronger than a memorable number a judge could ask you to reproduce.

**If asked about the synthetic visitors, answer before being asked.** "Those four are a patrol on a random schedule. They're the control arm — they tell us what the metric reads when there's no relationship there. We label them in the tool and they're excluded from every cohort number and from the clip pipeline." Volunteering this converts the project's biggest credibility risk into evidence of rigour.

**Jam-theme mapping, if a judge asks directly:**

- *Discoverability* — clip drafts typed by role, selected by a portfolio quota rather than a single score, each carrying a permalink and a resolvable receipt.
- *Engagement* — the unit is a grudge, not a session, and the return-visit path is measurable rather than asserted.
- *Workflow efficiency* — the owner gets a showrunner's note, role-balanced drafts, and an approval gate; nothing publishes itself; cost scales with narrative decisions, not cast size.

## The sentence that would be overclaiming

> ~~"We can prove that a returning visitor is more likely to come back because our NPCs remember them."~~

Do not say this. Four reasons, any one of which a technical judge could raise:

1. **n is essentially zero.** Every persisted database has no real visitor rows. Whatever number the tool prints on demo day comes from a patrol and a scripted run.
2. **No counterfactual.** There is no arm of this experiment where the NPC forgets. Without one, "more likely than what?" has no answer. The patrol is the beginning of an answer, not an answer.
3. **Identity is asserted, not authenticated.** "The same visitor returned" means "a client sent the same string twice."
4. **Byron Sharp's programme is the standing counterargument** with 60 years of data behind it, and the claim that depth *causes* return is exactly the causal direction his work finds least support for.

**The safe version, which is still strong:** *"We can show, from an append-only log, exactly what the world remembered about a specific person and verify that the memory was true. Whether that makes them come back is an experiment we can now run — and the tool to run it is the thing we built."*

Defensible against every objection above, and a better pitch anyway: the deliverable is measurement infrastructure for a claim, not the claim.

---

## Appendix A — File manifest

| File | Status | Purpose |
|---|---|---|
| `docs/affinity-thesis-and-spec.md` | this file | Argument + spec |
| `docs/affinity/002-affinity-tables.sql` | new | DDL to paste into `src/canon/db.ts`; bump `SCHEMA_VERSION` to 2 |
| `docs/affinity/queries.sql` | new | 23 named, parameterised queries covering every quantity in §3.3 and §3.9 |

All 23 queries in `queries.sql` were executed against a copy of `data/canon.db` with the `002` DDL applied; all 23 parse and run. Three are marked as needing the `visitors.synthetic` migration, with the workaround noted inline; the rest run against today's schema or the new tables.

**Nothing here is staged.** These three files are documentation only — nothing under `src/` or `scripts/` was modified by this document. Note that the working tree already contains unrelated in-flight work (`src/canon/significance.ts` and four modified files, assessed in §3.0), so `git add docs/` rather than `git add -A`.

## Appendix B — Sources

**Attention economics**

- Simon, H.A. (1971), "Designing Organizations for an Information-Rich World," in Greenberger (ed.), *Computers, Communications, and the Public Interest*, Johns Hopkins Press, pp. 40–41. Quote verified against primary text. https://veryinteractive.net/pdfs/simon_designing-organizations-for-an-information-rich-world.pdf
- Wu, T. (2016), *The Attention Merchants*, Knopf. https://www.penguinrandomhouse.com/books/234876/the-attention-merchants-by-tim-wu/ — "disenchantment effect" corroborated across reviews, not page-verified.

**The Sharp counterargument**

- Sharp, B. (2010), *How Brands Grow*, OUP. https://global.oup.com/academic/product/how-brands-grow-9780195573565
- Ehrenberg, Goodhardt & Barwise (1990), "Double Jeopardy Revisited," *J. Marketing* 54(3), 82–91. https://journals.sagepub.com/doi/10.1177/002224299005400307
- Goodhardt, Ehrenberg & Chatfield (1984), "The Dirichlet," *JRSS A* 147(5), 621–55.
- Riebe, Wright, Stern & Sharp (2014), "How to Grow a Brand: Retain or Acquire Customers?" *J. Business Research* 67(5), 990–997. https://www.sciencedirect.com/science/article/abs/pii/S0148296313003020
- Sharp, Romaniuk & Graham (2019), "Marketing's 60/20 Pareto Law," SSRN 3498097. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3498097
- Ehrenberg-Bass, "Answering critics" — source of the subscription / repertoire-of-one concession. https://marketingscience.info/news-and-insights/answering-critics
- Ritson's critiques, via *Marketing Week* — commentary, not peer-reviewed rebuttal. https://www.marketingweek.com/mark-ritson-targeting-mass-marketing/

**Retention economics — including what is folklore**

- Reichheld & Sasser (1990), "Zero Defections," *HBR* 68(5), 105–111. Real figures: 85% / 50% / 30%, industry-specific. https://hbr.org/1990/09/zero-defections-quality-comes-to-services
- The "25–95%" range comes from a Bain promotional brief with no disclosed methodology; the 95% ceiling is not in the 1990 study. https://media.bain.com/Images/BB_Prescription_cutting_costs.pdf
- Keiningham et al. (2007), "A Longitudinal Examination of Net Promoter and Firm Revenue Growth," *J. Marketing* — NPS does not outperform alternatives.
- Dick & Basu (1994), "Customer Loyalty: Toward an Integrated Conceptual Framework," *JAMS* 22, 99–113 — behavioural vs attitudinal loyalty. Conceptual; never fully operationalised by its authors. https://link.springer.com/article/10.1177/0092070394222001
- Chen, A., "How to Measure If Users Love Your Product Using Cohorts and Revisit Rates." Verified full text. https://andrewchen.com/how-to-measure-if-users-love-your-product-using-cohorts-and-revisit-rates/

**Parasocial and AI-parasocial**

- Horton, D. & Wohl, R.R. (1956), "Mass Communication and Para-Social Interaction," *Psychiatry* 19(3), 215–229. Quotes verified against a paginated full-text extract. http://visual-memory.co.uk/daniel/Documents/short/horton_and_wohl_1956.html
- Dibble, Hsu & Rosaen (2016), "Parasocial Interaction and Parasocial Relationship," *Human Communication Research* 42(1), 21–44 — PSI and EPSI do not measure the same construct. https://onlinelibrary.wiley.com/doi/abs/10.1111/hcre.12063
- Hung, Lee, Kasturiratna & Hartanto (2026), "Parasocial relationships with artificial intelligence (AI): A systematic review of benefits and risks," *Computers in Human Behavior: Artificial Humans*. PRISMA, 39 studies. https://www.sciencedirect.com/science/article/pii/S2949882126000757
- Ciriello, Hannon, Chen & Vaast, "Ethical Tensions in Human-AI Companionship: A Dialectical Inquiry into Replika," SSRN. https://doi.org/10.2139/ssrn.5285198
- 2023 meta-analysis, *Sustainability* 15(3), 2744 — 176 effect sizes, 62 studies, ~22,554 participants. Mid-tier venue, survey-based. https://www.mdpi.com/2071-1050/15/3/2744
- "The personalization–privacy paradox in the attention economy." https://www.researchgate.net/publication/344872076_The_personalization-privacy_paradox_in_the_attention_economy

**Engagement-metric critique**

- Wu, S., Rizoiu, M.-A. & Xie, L. (2018), "Beyond Views: Measuring and Predicting Engagement in Online Videos," *ICWSM*. 5.3M videos; relative engagement. https://arxiv.org/pdf/1709.02541
- "Deconfounding Duration Bias in Watch-time Prediction for Video Recommendation." https://arxiv.org/pdf/2206.06003
- Nelson-Field, K. (2020), *The Attention Economy and How Media Works*, Springer; Dentsu / Amplified Intelligence attention studies. https://www.dentsu.com/us/en/attention-economy

**Flagged as unverified or contested, and therefore not relied upon**

- The "5% retention → 25–95% profit" range (Bain brief, not peer-reviewed).
- The Twitch "33.7% of variance in donation behaviour" figure (untraceable to a peer-reviewed source).
- "Doubling mental availability yields 30–50% share growth" (secondary summaries only).
- The "63% of personalisation references are negative" figure (trade press).
- **No independently-authored peer-reviewed test of Double Jeopardy in creator-economy or persistent-world categories was found.** A gap in the literature, not a null result.

**Repo sources (read 21 August 2026)**

`SCHEMA.md` · `README.md` · `src/canon/db.ts` · `src/canon/repo.ts` · `src/canon/digest.ts` · `src/config.ts` · `src/types/events.ts` · `src/types/canon.ts` · `src/types/directive.ts` · `src/directive/apply.ts` · `src/tick/runTick.ts` · `src/tick/visitors.ts` · `src/runtime/character.ts` · `src/runtime/surface.ts` · `src/ip/outbound.ts` · `src/ip/source.ts` · `scripts/showrunner.ts` · `scripts/clock.ts` · `tests/citing.test.ts` · `tests/tick.test.ts` · `package.json` · `data/canon.db`, `data/tradeclash.db`, `data/voxel.db`
