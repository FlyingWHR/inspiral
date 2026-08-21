/**
 * CONTENT ROLES — what a clip is FOR, not how well it scored.
 *
 * The strongest operational claim in the attention frame is that the account,
 * not the post, is the compounding unit: the mistake is asking every post to
 * maximise every metric. That translates into a QUOTA OVER A WINDOW rather than
 * a score on an item, which is the difference between a feed that ranks and a
 * feed that is edited.
 *
 * Six roles, and each mapping below is an argument rather than a taxonomy:
 *
 *   trust      the world paying a cost it incurred. Credibility is only
 *              visible when it is expensive, so an arc resolving or a
 *              character conceding is the only thing in the vocabulary that
 *              demonstrates it.
 *   identity   makes a viewer take a side. `snub` is the cheapest identity
 *              content there is: someone is publicly excluded and the viewer
 *              instantly knows whether they think that was fair.
 *   conversion in a world with no commerce, the analogue of an open door is a
 *              storyline a visitor could walk into. An opened arc is a door;
 *              a resolved one is a door closing.
 *   community  a clip about a real person's real choice, with a resolvable
 *              receipt. The one role almost nobody else can produce -- and the
 *              one that must NEVER contain a synthetic visitor, because that
 *              would be the pipeline generating fake social proof.
 *   value      teaches something about how the world works.
 *   reach      spectacle, legible with no context at all.
 *
 * `hold` maps to null and is therefore never clipped. Given holds are around
 * 60% of the log, that single line is load-bearing.
 */

import type { WorldEvent } from "../types/events.js";

export const CONTENT_ROLES = [
  "reach",
  "value",
  "identity",
  "trust",
  "conversion",
  "community",
] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

/**
 * Derived from `payload.action`, NOT from `type`.
 *
 * ACTION_EVENT_TYPE maps `hold` onto `arc_advanced`, so the two are
 * indistinguishable by type -- the same collision that let 31 holds clear the
 * clip bar before significance was re-ranked.
 */
/**
 * Type-based fallback, for events that have no `payload.action`.
 *
 * INGESTED EVENTS HAVE NO ACTION. They come from `itemToEvent`, which sets a
 * type and a payload with `from_ip: true` but never an action, because no
 * directive produced them. Deriving from action alone therefore gave every beat
 * pulled from the owner's real feed a role of `null` -- so the one beat that
 * proves "you post and the world reacts" could never be clipped at all. A test
 * caught it; the histogram would not have, because null is also the correct
 * answer for the 91 holds it shares the bucket with.
 */
const TYPE_ROLE: Record<string, ContentRole> = {
  notice_posted: "value",
  confrontation: "reach",
  sabotage: "reach",
  rumor_spread: "reach",
  snub: "identity",
  alliance_offered: "identity",
  alliance_formed: "identity",
  alliance_broken: "identity",
  concession: "trust",
  arc_resolved: "trust",
  arc_opened: "conversion",
};

export function roleOf(e: Pick<WorldEvent, "type" | "actors" | "payload">): ContentRole | null {
  const action = (e.payload as { action?: string })?.action;
  const hasFan = e.actors.some((a) => a.startsWith("fan:"));

  // A hold is a character declining to act. Never clippable, and it is ~60% of
  // the log, so this line carries more weight than it looks.
  if (action === "hold") return null;
  if (hasFan) return "community";

  if (action) {
    if (e.type === "arc_resolved" || action === "concede") return "trust";
    if (
      action === "offer_alliance" ||
      action === "accept_alliance" ||
      action === "break_alliance" ||
      action === "snub"
    ) {
      return "identity";
    }
    if (action === "post_notice") return "value";
    if (e.type === "arc_opened") return "conversion";
    if (action === "confront" || action === "sabotage") return "reach";
    return null;
  }

  // No action: an ingested item, or a system event. Fall back to type.
  return TYPE_ROLE[e.type] ?? null;
}

export interface RolePolicy {
  role: ContentRole;
  min: number;
  max: number;
}

export const DEFAULT_POLICY: RolePolicy[] = [
  { role: "reach", min: 1, max: 3 },
  { role: "value", min: 1, max: 3 },
  { role: "identity", min: 1, max: 2 },
  { role: "trust", min: 1, max: 2 },
  { role: "conversion", min: 1, max: 1 },
  { role: "community", min: 0, max: 2 },
];

/**
 * Fill a slate against the quota, then by rank.
 *
 * `candidates` must already be ranked best-first by the caller -- on evidence,
 * not on the host's opinion of itself.
 *
 * The subtle requirement is step 3: a quiet world may genuinely have no `trust`
 * event this week, and the selector has to degrade to FEWER clips rather than
 * loop forever or pad the slate with junk.
 */
export function fillSlate<T>(
  candidates: T[],
  roleFor: (t: T) => ContentRole | null,
  limit: number,
  alreadyDrafted: Record<string, number> = {},
  policy: RolePolicy[] = DEFAULT_POLICY,
): T[] {
  const pools = new Map<ContentRole, T[]>();
  for (const c of candidates) {
    const r = roleFor(c);
    if (!r) continue;
    if (!pools.has(r)) pools.set(r, []);
    pools.get(r)!.push(c);
  }

  const taken: T[] = [];
  const used = new Set<T>();
  const countInSlate = (role: ContentRole) =>
    taken.filter((t) => roleFor(t) === role).length + (alreadyDrafted[role] ?? 0);

  const deficits = new Map<ContentRole, number>();
  for (const p of policy) {
    deficits.set(p.role, Math.max(0, p.min - (alreadyDrafted[p.role] ?? 0)));
  }

  while (taken.length < limit) {
    let best: ContentRole | null = null;
    for (const [role, d] of deficits) {
      if (d <= 0) continue;
      if (best === null || d > deficits.get(best)!) best = role;
    }
    if (best === null) break;

    const pool = (pools.get(best) ?? []).filter((t) => !used.has(t));
    if (!pool.length) {
      // No candidates for this role. Zero the deficit rather than spin.
      deficits.set(best, 0);
      continue;
    }
    taken.push(pool[0]!);
    used.add(pool[0]!);
    deficits.set(best, deficits.get(best)! - 1);
  }

  // Remaining slots by global rank, skipping any role already at its ceiling.
  for (const c of candidates) {
    if (taken.length >= limit) break;
    if (used.has(c)) continue;
    const r = roleFor(c);
    if (!r) continue;
    const cap = policy.find((p) => p.role === r)?.max ?? Infinity;
    if (countInSlate(r) >= cap) continue;
    taken.push(c);
    used.add(c);
  }

  return taken;
}
