/**
 * MINT -- paste a character sheet as text, get an inhabitant.
 *
 * This is the on-camera pipeline claim: a block of prose in, a living NPC out,
 * standing in the world and reacting to history that predates them. It is
 * deliberately forgiving about its input, because the demo is someone typing
 * into a textarea, not a well-formed API client.
 *
 * Everything the parser guesses is listed in README under Assumptions.
 */

import { CharacterSheet } from "../types/canon.js";
import type { CanonRepo } from "./repo.js";

export interface MintResult {
  sheet: CharacterSheet;
  eventId: string;
  /** Relationship edges created against the existing cast. */
  edges: number;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "newcomer";

/** Split "a, b; c" or a bulleted/newline list into trimmed items. */
function list(v: string): string[] {
  return v
    .split(/[\n;,]|(?:^|\s)[-*•]\s+/)
    .map((s) => s.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Parse a loose `Key: value` block. Unknown keys are ignored, missing keys take
 * schema defaults, and any text before the first key becomes the brief -- so
 * pasting a bare paragraph still produces a usable character.
 */
export function parseSheet(text: string, existingIds: string[] = []): CharacterSheet {
  const fields = new Map<string, string>();
  const loose: string[] = [];
  let key: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z _-]{1,24})\s*[:：]\s*(.*)$/.exec(line);
    if (m) {
      key = m[1]!.toLowerCase().replace(/[ _-]+/g, "");
      fields.set(key, m[2]!.trim());
    } else if (key) {
      fields.set(key, `${fields.get(key) ?? ""} ${line}`.trim());
    } else {
      loose.push(line);
    }
  }

  const get = (...names: string[]): string => {
    for (const n of names) {
      const v = fields.get(n);
      if (v) return v;
    }
    return "";
  };

  const name = get("name", "character", "who") || loose[0]?.slice(0, 60) || "The Newcomer";
  let id = slug(get("id", "characterid") || name);
  // Two Sera Vances would break every citation that names one of them.
  if (existingIds.includes(id)) {
    let n = 2;
    while (existingIds.includes(`${id}_${n}`)) n++;
    id = `${id}_${n}`;
  }

  const brief = get("brief", "bio", "description", "about", "summary") || loose.join(" ");

  return CharacterSheet.parse({
    character_id: id,
    name,
    faction: get("faction", "house", "side", "allegiance") || "Unaligned",
    title: get("title", "role", "job", "occupation"),
    brief: brief.slice(0, 2000),
    goals: list(get("goals", "goal", "wants", "want")),
    taboos: list(get("taboos", "taboo", "never", "limits")),
    voice: {
      register: get("register", "voice", "tone", "diction") || "plain",
      tics: list(get("tics", "tic", "verbaltics", "quirks")),
      max_words: Number(get("maxwords")) || 28,
    },
    mood: get("mood") || "even",
    home_location: slug(get("home", "homelocation", "location", "where")) || "plaza",
  });
}

/**
 * Write a parsed sheet into canon and wire it to the existing cast.
 *
 * The new arrival gets a mild edge to and from everyone already here -- not
 * neutral, because a character with no opinion of anyone has nothing to do, and
 * the tick loop needs somewhere to push. The mint itself is an append-only
 * event, so from the next tick onward the newcomer is part of the record and
 * can be cited like anyone else.
 */
export function mintCharacter(repo: CanonRepo, sheet: CharacterSheet): MintResult {
  repo.upsertCharacter(sheet);

  const others = repo.getCharacters().filter((c) => c.character_id !== sheet.character_id);
  for (const other of others) {
    repo.upsertRelationship({
      from_id: sheet.character_id,
      to_id: other.character_id,
      affinity: -5,
      trust: 40,
      tension: 20,
      note: `Has heard of ${other.name} and has not decided yet.`,
      last_event_id: null,
    });
    repo.upsertRelationship({
      from_id: other.character_id,
      to_id: sheet.character_id,
      affinity: -5,
      trust: 35,
      tension: 25,
      note: `A new face in the ward. ${other.name} is not pleased about the competition.`,
      last_event_id: null,
    });
  }

  const evt = repo.appendEvent({
    source: "system",
    actors: [sheet.character_id],
    type: "character_minted",
    payload: {
      summary: `${sheet.name}${sheet.title ? `, ${sheet.title}` : ""}, arrived in the ward and did not ask permission.`,
      faction: sheet.faction,
    },
    significance_hint: 0.6,
  });

  return { sheet, eventId: evt.event_id, edges: others.length * 2 };
}

/** Convenience: text in, inhabitant out. */
export function mintFromText(repo: CanonRepo, text: string): MintResult {
  const existing = repo.getCharacters().map((c) => c.character_id);
  return mintCharacter(repo, parseSheet(text, existing));
}
