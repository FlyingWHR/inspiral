/**
 * STRATEGIC SCENE SELECTION.
 *
 * A cast should not open into a random room. The archetype is chosen from the
 * compiled bible -- themes, tone, what the characters are to each other, what
 * the arcs are about -- so a geopolitical strategy game gets a council chamber
 * and a maker channel gets a studio.
 *
 * Two paths, and the cheap one is the floor:
 *
 *  - The host is ALREADY being asked to read the IP during onboarding. The
 *    archetype rides along in that same response. No extra invocation; the
 *    budget is ~12/day and a scene choice is not worth one of them.
 *  - When there is no host, or the response is malformed, or it names an
 *    archetype that does not exist, a keyword score over the bible picks one.
 *    It is deterministic and it always produces something defensible, which
 *    matters more than being clever: a wrong-but-reasoned tavern beats a
 *    coin-flip ballroom.
 */

import { z } from "zod";
import { ARCHETYPE_IDS, ARCHETYPES, DEFAULT_ARCHETYPE } from "../../web-voxel/scene/archetypes.js";

import type { IPBible } from "./bible.js";
import { log } from "../log.js";

/** The archetype library is plain JS; this is the shape TypeScript needs. */
interface ArchetypeMeta {
  id: string;
  name: string;
  affords: string;
  places: Record<string, { x: number; z: number }>;
}
const LIBRARY = ARCHETYPES as unknown as Record<string, ArchetypeMeta | undefined>;

/** Validated like every other thing a host says. */
export const SceneChoice = z.object({
  archetype: z.enum(ARCHETYPE_IDS as [string, ...string[]]),
  reason: z.string().max(240).default(""),
  /** How the choice was made, for the CLI and the gate. */
  chosen_by: z.enum(["host", "heuristic", "default"]).default("heuristic"),
});
export type SceneChoice = z.infer<typeof SceneChoice>;

/**
 * Words that point at a scene. Weighted: a term in the second list is a strong
 * signal, the first is a nudge. Kept small and legible on purpose -- this is a
 * fallback, and a fallback nobody can read is a fallback nobody trusts.
 */
const SIGNALS: Record<string, { weak: string[]; strong: string[] }> = {
  council_chamber: {
    weak: ["policy", "vote", "law", "court", "empire", "nation", "faction", "diplomacy", "crown"],
    strong: ["council", "senate", "parliament", "chancellor", "premier", "treaty", "tariff",
             "duty", "toll", "trade", "throne", "minister", "governor", "delegate", "summit"],
  },
  training_hall: {
    weak: ["train", "fight", "strong", "compete", "coach", "team", "discipline"],
    strong: ["gym", "dojo", "martial", "sparring", "wrestling", "boxing", "belt", "sensei",
             "workout", "athlete", "tournament", "rank", "champion"],
  },
  ballroom: {
    weak: ["society", "noble", "family", "wealth", "secret", "romance", "manner"],
    strong: ["ballroom", "gala", "court", "debutante", "aristocrat", "duchess", "estate",
             "season", "waltz", "salon", "high society", "dynasty"],
  },
  arena: {
    weak: ["fans", "crowd", "match", "season", "league", "score", "rival"],
    strong: ["arena", "stadium", "esports", "spectator", "audience roar", "championship",
             "tournament bracket", "fixture", "supporters", "derby"],
  },
  studio: {
    weak: ["video", "post", "upload", "uploads", "audience", "brand", "content", "subscriber",
           "subscribers", "workshop", "restoration", "maker", "project", "projects", "build",
           "tools", "shop", "series", "viewers"],
    strong: ["studio", "channel", "youtube", "podcast", "stream", "streamer", "creator",
             "newsroom", "broadcast", "episode", "vlog", "on camera", "to camera"],
  },
  cafe: {
    weak: ["friends", "everyday", "small", "quiet", "slice of life", "hangout"],
    strong: ["cafe", "café", "coffee", "diner", "bakery", "lounge", "barista", "sitcom"],
  },
  market_plaza: {
    weak: ["town", "city", "district", "trade", "merchant", "public", "civic", "guild"],
    strong: ["market", "plaza", "square", "ward", "bazaar", "quarter", "township", "borough"],
  },
  tavern: {
    weak: ["drink", "regular", "rumour", "rumor", "gossip", "feud", "grudge", "village"],
    strong: ["tavern", "inn", "pub", "bar", "alehouse", "innkeeper", "landlord", "saloon"],
  },
};

/**
 * Match on whole words, not substrings.
 *
 * A plain `corpus.includes("bar")` fires on "barrels", "inn" on "beginning",
 * "pub" on "public" and "court" on "courtesy". The creator fixture -- a cooper
 * restoring a workshop -- scored as a TAVERN because its barrels contain the
 * word bar. Single terms are tested against a token set; multi-word phrases
 * still use a substring test, which is safe because they are distinctive.
 */
function matcher(corpus: string): (term: string) => boolean {
  const tokens = new Set(corpus.split(/[^\p{L}\p{N}']+/u).filter(Boolean));
  return (term) => (term.includes(" ") ? corpus.includes(term) : tokens.has(term));
}

/** Everything in the bible that could carry a signal, lowercased. */
function corpusOf(bible: IPBible): string {
  const parts: string[] = [
    bible.world_name,
    bible.summary,
    bible.audience_tone,
    ...bible.themes,
    ...bible.characters.flatMap((c) => [c.name, c.title, c.faction, c.brief, ...c.goals]),
    ...bible.arcs.map((a) => `${a.title} ${a.summary}`),
    ...bible.lore.map((l) => l.statement),
    bible.tone?.register ?? "",
  ];
  return parts.join(" \n ").toLowerCase();
}

export interface ScoredScene {
  archetype: string;
  score: number;
  hits: string[];
}

/** Score every archetype against the bible. Exported so a test can inspect it. */
export function scoreScenes(bible: IPBible): ScoredScene[] {
  const has = matcher(corpusOf(bible));
  const scored: ScoredScene[] = [];

  for (const [archetype, sig] of Object.entries(SIGNALS)) {
    let score = 0;
    const hits: string[] = [];
    for (const w of sig.strong) {
      if (has(w)) {
        score += 3;
        hits.push(w);
      }
    }
    for (const w of sig.weak) {
      if (has(w)) {
        score += 1;
        hits.push(w);
      }
    }
    scored.push({ archetype, score, hits });
  }

  // Ties break by archetype id so the same bible always lands the same way.
  return scored.sort((a, b) => b.score - a.score || a.archetype.localeCompare(b.archetype));
}

/** The deterministic path: no host, or the host was no help. */
export function chooseSceneHeuristically(bible: IPBible): SceneChoice {
  const ranked = scoreScenes(bible);
  const top = ranked[0];

  if (!top || top.score === 0) {
    return {
      archetype: DEFAULT_ARCHETYPE,
      reason:
        "nothing in the source pointed anywhere in particular, and a tavern is where a cast " +
        "with grudges and regulars is most at home",
      chosen_by: "default",
    };
  }

  const arch = LIBRARY[top.archetype]!;
  const evidence = top.hits.slice(0, 3).join(", ");
  return {
    archetype: top.archetype,
    reason: `${arch.affords} — matched on ${evidence}`,
    chosen_by: "heuristic",
  };
}

/**
 * Pick the scene. `hostSuggestion` is whatever the onboard response contained
 * under `scene`; anything unusable is dropped and the heuristic stands, which
 * is how every other host output in this codebase is treated.
 */
export function chooseScene(bible: IPBible, hostSuggestion?: unknown): SceneChoice {
  if (hostSuggestion !== undefined && hostSuggestion !== null) {
    const parsed = SceneChoice.safeParse(hostSuggestion);
    if (parsed.success) {
      return { ...parsed.data, chosen_by: "host" };
    }
    log.warn(
      `scene choice from host rejected (${parsed.error.issues[0]?.message ?? "shape"}); ` +
        `falling back to the heuristic`,
    );
  }
  return chooseSceneHeuristically(bible);
}

/** One line for the CLI and the approval gate. */
export function describeScene(choice: SceneChoice): string {
  const arch = LIBRARY[choice.archetype];
  const name = arch?.name ?? choice.archetype;
  const how = choice.chosen_by === "host" ? "" : ` (${choice.chosen_by})`;
  return `${name}${how} — ${choice.reason || arch?.affords || ""}`;
}

export { ARCHETYPE_IDS, ARCHETYPES, DEFAULT_ARCHETYPE };
