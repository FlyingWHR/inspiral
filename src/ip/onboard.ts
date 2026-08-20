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

/**
 * What an enrichment attempt actually produced.
 *
 * `enriched` used to be the whole answer, and it lied. A response carrying only
 * `summary`, `themes` and `tone` has mergeable keys, passes validation, merges
 * cleanly and sets `enriched: true` -- while adding no characters and no arcs.
 * That is the difference between a world that exists and a world that runs, and
 * it was reported as a success. `arcs` and `characters` are counted separately
 * now so the caller can tell a real enrichment from a tonal one.
 */
export interface EnrichResult {
  bible: IPBible;
  enriched: boolean;
  arcs: number;
  characters: number;
  /** Top-level keys the host actually sent, for the log line when it goes wrong. */
  keys: string[];
}

export function mergeEnrichment(draft: IPBible, raw: string): EnrichResult {
  // Every rejection path below used to return silently, so a host that came
  // back with prose, or with only keys we do not merge, looked identical to a
  // host that was never called. The fallback is meant to be invisible in
  // BEHAVIOUR, not in the logs.
  const snippet = raw.replace(/\s+/g, " ").slice(0, 120);

  const json = extractJson(raw);
  if (!json) {
    log.warn(`onboard enrichment: no JSON object in the response -- "${snippet}"`);
    return { bible: draft, enriched: false, arcs: 0, characters: 0, keys: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    log.warn(`onboard enrichment: JSON did not parse (${(e as Error).message}) -- "${snippet}"`);
    return { bible: draft, enriched: false, arcs: 0, characters: 0, keys: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    log.warn(`onboard enrichment: response was not a JSON object -- "${snippet}"`);
    return { bible: draft, enriched: false, arcs: 0, characters: 0, keys: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const touched = BIBLE_KEYS.filter((k) => obj[k] !== undefined);
  if (touched.length === 0) {
    log.warn(
      `onboard enrichment: response had no mergeable keys ` +
        `(returned: ${Object.keys(obj).join(", ") || "none"}; mergeable: ${BIBLE_KEYS.join(", ")})`,
    );
    return { bible: draft, enriched: false, arcs: 0, characters: 0, keys: Object.keys(obj) };
  }
  log.info(`onboard enrichment: merging ${touched.join(", ")}`);

  const hints = IPHints.safeParse(obj);
  if (!hints.success) {
    log.warn(`onboard enrichment rejected: ${hints.error.issues[0]?.message ?? "shape"}`);
    return { bible: draft, enriched: false, arcs: 0, characters: 0, keys: Object.keys(obj) };
  }

  const merged = IPBible.safeParse({ ...draft, ...hints.data });
  if (!merged.success) {
    log.warn(`onboard enrichment did not survive validation; keeping the draft`);
    return { bible: draft, enriched: false, arcs: 0, characters: 0, keys: Object.keys(obj) };
  }
  return {
    bible: merged.data,
    enriched: true,
    arcs: merged.data.arcs.length,
    characters: merged.data.characters.length,
    keys: Object.keys(obj),
  };
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
    const prompt = enrichPrompt(
      source.handle,
      renderSourcePack(source.handle, items),
      JSON.stringify(bible),
    );

    /**
     * ONE RETRY, AND ONLY ON A SPECIFIC FAILURE.
     *
     * Measured against a live Mind, roughly one onboarding call in three came
     * back with a response that parsed, validated and merged -- and contained
     * no arcs. Two shapes did it: a tonal-only reply carrying `summary`,
     * `themes` and `tone` but no cast, and a `{"directives": [...]}` payload,
     * which is the TICK schema answered on the onboarding lane. The second one
     * is the giveaway: the lane's history had accumulated tick replies, and the
     * Mind pattern-matches its own past answers.
     *
     * A bible with no arcs is a cast that exists and a world that does not run,
     * so it is worth one more invocation. It retries ONLY on zero arcs -- not
     * on a transport failure, not on a rejection, and never more than once.
     */
    // A deterministic host returns the identical answer to the identical
    // prompt, so a retry against one is a wasted invocation by construction.
    const maxAttempts = host.deterministic ? 1 : 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      hostCalls = attempt;
      const res = await host.ask({ kind: "onboard", prompt });
      repo.recordHostInvocation({
        alias: "onboard",
        kind: "onboard",
        ok: res.ok,
        latencyMs: res.latencyMs,
        ...(res.ok ? {} : { error: res.message }),
      });

      if (!res.ok) {
        log.warn(`onboard host call failed (${res.reason}); the compiled draft stands`);
        break;
      }

      const m = mergeEnrichment(bible, res.text);
      bible = m.bible;
      enriched = m.enriched;
      hostScene = extractScene(res.text);

      if (m.arcs > 0) {
        if (attempt > 1) log.info(`onboard enrichment: retry produced ${m.arcs} arcs`);
        break;
      }

      /**
       * The loud version of the silent failure. This used to merge quietly and
       * report success, and the only visible symptom was "0 arcs -> 0 arcs" on
       * the headline demo, on camera, with nothing in the log to explain it.
       */
      log.warn(
        `onboard enrichment produced NO ARCS ` +
          `(merged=${m.enriched}, characters=${m.characters}, ` +
          `keys=[${m.keys.join(", ") || "none"}], ${res.text.length} chars in ${res.latencyMs}ms)`,
      );
      if (m.keys.includes("directives")) {
        log.warn(
          `  the host answered with the TICK schema on the onboarding lane -- ` +
            `its history has taught it the wrong shape. A fresh alias fixes the cause: ` +
            `set INSPIRAL_ALIAS_ONBOARD to an unused name.`,
        );
      }
      if (attempt < maxAttempts) log.warn(`  retrying once`);
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
