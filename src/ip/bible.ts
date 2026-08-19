import { z } from "zod";
import { Arc, CharacterSheet, Relationship, ToneRules } from "../types/canon.js";
import type { NewWorldEvent } from "../types/events.js";
import type { WorldSpec } from "../canon/seed.js";
import type { RawItem } from "./source.js";

/**
 * THE IP BIBLE.
 *
 * What the showrunner holds: who the cast is, how they sound, what the world is
 * about, what is already true, and who owes whom what. It is a draft until the
 * owner approves it, and once approved it becomes a `WorldSpec` and goes
 * through the one and only seed path.
 *
 * Compilation is deterministic and costs zero host invocations. The host is
 * asked ONCE, afterwards, to enrich the draft -- see `onboard.ts`. That order
 * matters: with the mock host (or a dead vendor) onboarding still produces a
 * real, seedable world instead of failing.
 */

export const LoreEntry = z.object({
  statement: z.string().min(1).max(500),
  about: z.array(z.string().max(64)).max(8).default([]),
  source_url: z.string().max(500).optional(),
  ts: z.string().optional(),
});
export type LoreEntry = z.infer<typeof LoreEntry>;

export const IPBible = z.object({
  world_name: z.string().min(1).max(120),
  ip_handle: z.string().min(1).max(120),
  summary: z.string().max(2000).default(""),
  themes: z.array(z.string().max(80)).max(12).default([]),
  audience_tone: z.string().max(500).default(""),
  characters: z.array(CharacterSheet).min(1).max(24),
  relationships: z.array(Relationship).default([]),
  arcs: z.array(Arc).default([]),
  tone: ToneRules,
  lore: z.array(LoreEntry).max(40).default([]),
  /** Provenance. Every claim above should be traceable to one of these. */
  sources: z
    .array(
      z.object({
        item_id: z.string().max(120),
        kind: z.string().max(32),
        ts: z.string().max(40),
        url: z.string().max(500).optional(),
      }),
    )
    .default([]),
});
export type IPBible = z.infer<typeof IPBible>;

/** What a fixture may ship pre-extracted, or the host may return. All optional. */
export const IPHints = IPBible.partial();
export type IPHints = z.infer<typeof IPHints>;

// ---------------------------------------------------------------------------
// Deterministic extraction
// ---------------------------------------------------------------------------

const STOP = new Set(
  ("the and for that with this from have they been will your what when just about into over " +
    "than then them their there here more most some such only also very much many other").split(" "),
);

/** Hashtags first, because a creator has already told you what their IP is about. */
export function extractThemes(items: RawItem[], limit = 6): string[] {
  const tags = new Map<string, number>();
  const words = new Map<string, number>();
  for (const i of items) {
    for (const m of i.text.matchAll(/#([a-z0-9_]{3,30})/gi)) {
      const t = m[1]!.toLowerCase();
      tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    for (const m of i.text.toLowerCase().matchAll(/\b[a-z]{5,20}\b/g)) {
      const w = m[0];
      if (STOP.has(w)) continue;
      words.set(w, (words.get(w) ?? 0) + 1);
    }
  }
  const rank = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return [...rank(tags), ...rank(words).filter((w) => (words.get(w) ?? 0) > 1)].slice(0, limit);
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "owner";

/** One line of prose per item, trimmed to something an NPC could actually say. */
function statementOf(i: RawItem): string {
  const t = i.text.replace(/\s+/g, " ").trim();
  return t.length > 220 ? `${t.slice(0, 217)}...` : t;
}

/**
 * Raw items in, draft bible out. No host call, no network, no randomness.
 *
 * `hints` is what a fixture ships pre-extracted (or what the host returned).
 * Anything it supplies wins; anything it omits is derived from the items. That
 * split is deliberate: it is exactly the list of things a real Mind has to do
 * for a real account, and it is visible in one place.
 */
export function compileBible(
  handle: string,
  items: RawItem[],
  hints: IPHints | null = null,
): IPBible {
  const h = hints ?? {};
  const profile = items.find((i) => i.kind === "profile");
  const ranked = [...items]
    .filter((i) => i.kind !== "profile")
    .sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0));

  const world_name = h.world_name ?? profile?.text.split(/[.\n]/)[0]?.trim().slice(0, 60) ?? handle;
  // The account's own handle, not the fixture directory it happens to live in.
  const owner = profile?.author ?? items[0]?.author ?? handle;

  const characters: CharacterSheet[] =
    h.characters && h.characters.length
      ? h.characters.map((c) => CharacterSheet.parse(c))
      : [
          CharacterSheet.parse({
            character_id: slug(owner),
            name: owner,
            faction: world_name,
            title: "the one whose world this is",
            brief: profile?.text ?? `Everything here came out of ${owner}'s feed.`,
            voice: { register: h.audience_tone ?? "direct, familiar, unhurried" },
          }),
        ];

  const ids = characters.map((c) => c.character_id);
  const relationships: Relationship[] =
    h.relationships && h.relationships.length
      ? h.relationships.map((r) => Relationship.parse(r))
      : // No graph supplied: give everyone a mild, undecided edge to everyone
        // else. Neutral characters have nothing to do and the tick has nowhere
        // to push, so "undecided" is the floor, not zero.
        ids.flatMap((a) =>
          ids
            .filter((b) => b !== a)
            .map((b) =>
              Relationship.parse({
                from_id: a,
                to_id: b,
                affinity: -5,
                trust: 40,
                tension: 25,
                note: `Has an opinion about ${b} and has not said it out loud.`,
                last_event_id: null,
              }),
            ),
        );

  const arcs: Arc[] =
    h.arcs && h.arcs.length
      ? h.arcs.map((a) => Arc.parse(a))
      : ranked[0] && ids.length >= 2
        ? [
            Arc.parse({
              arc_id: `arc_${slug(world_name)}_1`,
              title: statementOf(ranked[0]).slice(0, 80),
              participants: ids.slice(0, 2),
              status: "open",
              stage: 0,
              tension: 45,
              summary: statementOf(ranked[0]),
            }),
          ]
        : [];

  const themes = h.themes?.length ? h.themes : extractThemes(items);

  const tone: ToneRules = ToneRules.parse(
    h.tone ?? {
      world_id: "default",
      register:
        h.audience_tone ??
        `The voice of ${handle}'s feed: ${themes.slice(0, 3).join(", ") || "plain and direct"}. ` +
          `Nobody explains the premise and nobody addresses the camera.`,
      banned_phrases: ["as you know", "little did they know", "greetings, traveler", "in this world"],
      forbidden_topics: [],
      max_line_words: 32,
    },
  );

  const lore: LoreEntry[] = (h.lore?.length ? h.lore : ranked.slice(0, 8).map((i) => {
    const e: LoreEntry = { statement: statementOf(i), about: i.actors ?? [], ts: i.ts };
    if (i.url) e.source_url = i.url;
    return e;
  })).map((l) => LoreEntry.parse(l));

  return IPBible.parse({
    world_name,
    ip_handle: handle,
    summary:
      h.summary ??
      `${world_name}, compiled from ${items.length} item(s) off ${handle}. ` +
        `${characters.length} character(s), ${arcs.length} open storyline(s).`,
    themes,
    audience_tone: h.audience_tone ?? tone.register,
    characters,
    relationships,
    arcs,
    tone,
    lore,
    sources: items.map((i) => ({
      item_id: i.item_id,
      kind: i.kind,
      ts: i.ts,
      ...(i.url ? { url: i.url } : {}),
    })),
  });
}

/**
 * Bible -> WorldSpec. This is the only bridge into canon, and it exists so the
 * IP path reuses `seedFrom` rather than growing a second way to write day zero.
 *
 * Lore becomes REAL LOG ENTRIES, not prose in a config file. That is the whole
 * point: on day 6 an NPC can cite the owner's actual pinned post by event_id.
 */
export function bibleToWorldSpec(bible: IPBible): WorldSpec {
  const cast = bible.characters.map((c) => c.character_id);

  const history: NewWorldEvent[] = [
    {
      source: "seed",
      actors: cast,
      type: "world_created",
      payload: {
        world: bible.world_name,
        ip_handle: bible.ip_handle,
        summary: `${bible.world_name} exists, compiled from ${bible.ip_handle}.`,
        themes: bible.themes,
      },
      significance_hint: 0.2,
    },
    ...bible.lore.map((l, idx): NewWorldEvent => {
      const actors = l.about.filter((a) => cast.includes(a));
      return {
        source: "seed",
        // Everything already public in the IP is on the world's board.
        type: "notice_posted",
        actors: actors.length ? actors : [cast[idx % cast.length]!],
        payload: {
          summary: l.statement,
          ...(l.source_url ? { url: l.source_url } : {}),
          from_ip: true,
        },
        significance_hint: 0.65,
        ...(l.ts ? { ts: l.ts } : {}),
      };
    }),
  ];

  return {
    world_name: bible.world_name,
    characters: bible.characters,
    relationships: bible.relationships,
    arcs: bible.arcs,
    tone: bible.tone,
    history,
    facts: bible.themes.map((t) => ({ statement: `This world is about ${t}.`, about: [] })),
  };
}

/** Human-readable draft, for the approval gate and the terminal. */
export function renderBible(b: IPBible): string {
  const L: string[] = [];
  L.push(`IP BIBLE (DRAFT) -- ${b.world_name}`);
  L.push(`from ${b.ip_handle}, ${b.sources.length} source item(s)`);
  L.push("");
  if (b.summary) L.push(b.summary, "");
  if (b.themes.length) L.push(`THEMES: ${b.themes.join(", ")}`, "");
  L.push(`AUDIENCE TONE`, `  ${b.audience_tone}`, "");
  L.push("CAST");
  for (const c of b.characters) {
    L.push(`  ${c.character_id}  ${c.name} -- ${c.title || "(no title)"}, ${c.faction}`);
    if (c.brief) L.push(`      ${c.brief.slice(0, 160)}`);
    L.push(`      voice: ${c.voice.register}${c.voice.tics.length ? ` (${c.voice.tics.join("; ")})` : ""}`);
  }
  L.push("");
  L.push("RELATIONSHIP GRAPH (directed)");
  for (const r of b.relationships) {
    L.push(`  ${r.from_id} -> ${r.to_id}  affinity ${r.affinity}, trust ${r.trust}, tension ${r.tension}`);
    if (r.note) L.push(`      "${r.note}"`);
  }
  L.push("");
  L.push("OPEN STORYLINES");
  if (!b.arcs.length) L.push("  (none)");
  for (const a of b.arcs) L.push(`  ${a.arc_id} [${a.participants.join(", ")}] ${a.title}`);
  L.push("");
  L.push("EXISTING LORE (becomes citable day-zero events)");
  for (const l of b.lore) L.push(`  - ${l.statement}${l.source_url ? `  <${l.source_url}>` : ""}`);
  L.push("");
  L.push("TONE RULES");
  L.push(`  ${b.tone.register}`);
  L.push(`  never write: ${b.tone.banned_phrases.join("; ") || "(nothing banned)"}`);
  L.push(`  max ${b.tone.max_line_words} words per line`);
  return L.join("\n");
}
