import type { CanonRepo } from "../canon/repo.js";
import { seedFrom } from "../canon/seed.js";
import type { HostRuntime } from "../host/HostRuntime.js";
import { extractJson } from "../directive/validate.js";
import type { ApprovalChannel } from "../approval/index.js";
import { applyPatch } from "../approval/index.js";
import { compileBible, bibleToWorldSpec, renderBible, IPBible, IPHints } from "./bible.js";
import type { IPSource, RawItem } from "./source.js";
import { INGEST_CURSOR_KEY, markIngested } from "./ingest.js";
import { log } from "../log.js";
import { ARCHETYPE_IDS, ARCHETYPES, chooseScene } from "./scene.js";

/** Canon meta key holding the chosen archetype, read by the voxel surface. */
export const SCENE_KEY = "scene_archetype";

/** The archetype menu, rendered into the prompt so it cannot drift. */
const SCENE_LIST = ARCHETYPE_IDS.map(
  (id) => `  ${id} -- ${(ARCHETYPES as Record<string, { affords: string }>)[id]!.affords}`,
).join("\n");

/**
 * ONBOARDING: handles in, living cast out.
 *
 *   IPSource -> raw items -> source pack -> draft bible -> host enrichment
 *            -> APPROVAL GATE -> WorldSpec -> seedFrom()
 *
 * Two things are load-bearing about that order.
 *
 * The draft is compiled BEFORE the host is asked, so a dead vendor or a mock
 * host still produces a seedable world. The host makes the bible better; it is
 * never what makes the bible exist.
 *
 * The gate is the LAST step. `seedFrom` is not called on any path where the
 * owner said no, and there is exactly one call site for it in this file.
 *
 * Cost: ONE host invocation per onboard, regardless of how many items the
 * source yields. Nothing in here calls out per item.
 */

const PACK_ITEM_LIMIT = 40;

/** The briefing the host is asked to enrich. Small on purpose. */
export function renderSourcePack(handle: string, items: RawItem[]): string {
  const ranked = [...items].sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0));
  const L: string[] = [];
  L.push(`IP SOURCE PACK -- ${handle}`);
  L.push(`${items.length} item(s); the ${Math.min(items.length, PACK_ITEM_LIMIT)} most engaged shown.`);
  L.push("");
  for (const i of ranked.slice(0, PACK_ITEM_LIMIT)) {
    const m = i.metrics
      ? ` (${[
          i.metrics.views ? `${i.metrics.views} views` : "",
          i.metrics.likes ? `${i.metrics.likes} likes` : "",
          i.metrics.comments ? `${i.metrics.comments} comments` : "",
        ]
          .filter(Boolean)
          .join(", ")})`
      : "";
    L.push(`[${i.kind}] ${i.ts} ${i.item_id}${m}`);
    L.push(`  ${i.text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  return L.join("\n");
}

function enrichPrompt(handle: string, pack: string, draftJson: string): string {
  return `You are the showrunner for a world built out of ${handle}'s existing IP.

Below is the raw source pack and a DRAFT BIBLE that was compiled from it
mechanically. The draft is correct but thin: it has the facts and none of the
judgement.

Return ONE JSON object and nothing else -- no prose, no code fence. Include only
the keys you are actually improving. Any key you return replaces the draft's.

Keys you may return:
  world_name, summary, themes[], audience_tone,
  characters[]     {character_id, name, faction, title, brief, goals[], taboos[],
                    voice:{register,tics[],max_words}, mood, home_location}
  relationships[]  {from_id, to_id, affinity, trust, tension, note}
  arcs[]           {arc_id, title, participants[], stage, tension, summary}
  tone             {register, banned_phrases[], forbidden_topics[], max_line_words}
  scene            {archetype, reason}

SCENE
Pick the one place this cast most belongs, from exactly this list:
${SCENE_LIST}
Where people stand is characterisation: a tavern affords grudges and regulars,
a council chamber affords procedure and standing, an arena affords an audience
taking sides. "reason" is one short line the owner will read.

RULES
- Keep every character_id that is already in the draft. You may add, never rename.
- Relationships are DIRECTED and should be asymmetric. Symmetry is boring.
- Do not invent lore. Everything you assert must be visible in the source pack.
- The owner reads this next and can reject it.

=== SOURCE PACK ===
${pack}
=== DRAFT BIBLE ===
${draftJson}
=== END ===

JSON only.`;
}

const BIBLE_KEYS = [
  "world_name",
  "summary",
  "themes",
  "audience_tone",
  "characters",
  "relationships",
  "arcs",
  "tone",
  "lore",
] as const;

/**
 * Merge a host response into the draft. Anything unparseable, empty, or
 * shape-invalid is DROPPED and the draft stands -- onboarding degrades the
 * same way a tick does.
 */
/** The scene block out of a host response, if there is one. Never throws. */
export function extractScene(raw: string): unknown {
  const json = extractJson(raw);
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed.scene : undefined;
  } catch {
    return undefined;
  }
}

export function mergeEnrichment(draft: IPBible, raw: string): { bible: IPBible; enriched: boolean } {
  const json = extractJson(raw);
  if (!json) return { bible: draft, enriched: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { bible: draft, enriched: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { bible: draft, enriched: false };

  const obj = parsed as Record<string, unknown>;
  const touched = BIBLE_KEYS.filter((k) => obj[k] !== undefined);
  if (touched.length === 0) return { bible: draft, enriched: false };

  const hints = IPHints.safeParse(obj);
  if (!hints.success) {
    log.warn(`onboard enrichment rejected: ${hints.error.issues[0]?.message ?? "shape"}`);
    return { bible: draft, enriched: false };
  }

  const merged = IPBible.safeParse({ ...draft, ...hints.data });
  if (!merged.success) {
    log.warn(`onboard enrichment did not survive validation; keeping the draft`);
    return { bible: draft, enriched: false };
  }
  return { bible: merged.data, enriched: true };
}

export interface OnboardOptions {
  source: IPSource;
  repo: CanonRepo;
  approval: ApprovalChannel;
  /** Omit to skip enrichment entirely (still fully functional). */
  host?: HostRuntime;
  editPath?: string;
}

export interface OnboardResult {
  status: "seeded" | "rejected" | "already-seeded";
  bible: IPBible;
  itemsRead: number;
  /** True when the host returned something that survived validation. */
  enriched: boolean;
  /** Always 0 or 1. This is the cost claim, asserted in the tests. */
  hostCalls: number;
  reason?: string;
}

export async function onboardIP(opts: OnboardOptions): Promise<OnboardResult> {
  const { source, repo, approval, host } = opts;

  const items = await source.fetch();
  const rawHints = (await source.hints?.()) ?? null;
  const parsedHints = rawHints ? IPHints.safeParse(rawHints) : null;
  if (parsedHints && !parsedHints.success) {
    log.warn(`${source.name}: hints.json is malformed and was ignored`);
  }

  let bible = compileBible(source.handle, items, parsedHints?.success ? parsedHints.data : null);

  // ---- one host invocation, and only one ----------------------------------
  let enriched = false;
  let hostCalls = 0;
  let hostScene: unknown;
  if (host) {
    hostCalls = 1;
    const res = await host.ask({
      kind: "onboard",
      prompt: enrichPrompt(source.handle, renderSourcePack(source.handle, items), JSON.stringify(bible)),
    });
    repo.recordHostInvocation({
      alias: "onboard",
      kind: "onboard",
      ok: res.ok,
      latencyMs: res.latencyMs,
      ...(res.ok ? {} : { error: res.message }),
    });
    if (res.ok) {
      const m = mergeEnrichment(bible, res.text);
      bible = m.bible;
      enriched = m.enriched;
      hostScene = extractScene(res.text);
    } else {
      log.warn(`onboard host call failed (${res.reason}); the compiled draft stands`);
    }
  }

  // ---- which world does this cast belong in --------------------------------
  // Costs nothing: the host was already asked, and if it said nothing usable a
  // keyword score over the finished bible picks something defensible.
  bible = { ...bible, scene: chooseScene(bible, hostScene) };

  // ---- the gate -----------------------------------------------------------
  const decision = await approval.review({
    title: `Approve the world compiled from ${source.name}?`,
    body: renderBible(bible),
    draft: bible,
    ...(opts.editPath ? { editPath: opts.editPath } : {}),
  });

  if (decision.verdict === "reject") {
    return {
      status: "rejected",
      bible,
      itemsRead: items.length,
      enriched,
      hostCalls,
      reason: decision.reason,
    };
  }

  if (decision.verdict === "edit") {
    const patched = IPBible.safeParse(applyPatch(bible, decision.patch));
    if (patched.success) bible = patched.data;
    else
      log.warn(
        `owner's edit did not validate (${patched.error.issues[0]?.message ?? "shape"}); seeding the unedited draft`,
      );
  }

  // ---- the ONLY write into canon on this path -----------------------------
  const created = seedFrom(repo, bibleToWorldSpec(bible));
  if (!created) {
    return {
      status: "already-seeded",
      bible,
      itemsRead: items.length,
      enriched,
      hostCalls,
      reason: `${repo.getMeta("world_name") ?? "a world"} is already seeded in this database`,
    };
  }

  repo.setMeta("ip_handle", bible.ip_handle);
  repo.setMeta("ip_source", source.name);
  repo.setMeta("ip_bible", JSON.stringify(bible));
  if (bible.scene) repo.setMeta(SCENE_KEY, bible.scene.archetype);
  // The back catalogue is now day-zero canon. Ingestion starts after it, or it
  // would replay the whole account as breaking news.
  const newest = items.reduce((max, i) => (i.ts > max ? i.ts : max), "");
  if (newest) repo.setMeta(INGEST_CURSOR_KEY, newest);
  markIngested(repo, items);

  return { status: "seeded", bible, itemsRead: items.length, enriched, hostCalls };
}

/** The approved bible, if this database was onboarded from an IP source. */
export function loadBible(repo: CanonRepo): IPBible | undefined {
  const raw = repo.getMeta("ip_bible");
  if (!raw) return undefined;
  const p = IPBible.safeParse(JSON.parse(raw));
  return p.success ? p.data : undefined;
}
