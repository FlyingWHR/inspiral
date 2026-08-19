import type { CanonRepo } from "./repo.js";
import type { Arc, CharacterSheet, Relationship, ToneRules } from "../types/canon.js";
import type { NewWorldEvent } from "../types/events.js";

/**
 * DAY-ZERO CANON.
 *
 * Cold start is not solved by prompting an empty world into being interesting.
 * It is solved by shipping the world with a past. These three already owe each
 * other money, favours and humiliations before a single tick fires, so the
 * first tick has something to be *about*.
 *
 * The district is small on purpose. Three leaders, one board, one debt, one
 * lease. Small worlds generate legible history; large ones generate noise.
 */

export const WORLD_NAME = "Tallow Ward";

export const CHARACTERS: CharacterSheet[] = [
  {
    character_id: "vance",
    name: "Sera Vance",
    faction: "The Ledger",
    title: "Assessor of the Ledger",
    brief:
      "Keeps the ward's debts in a locked book and her feelings in a locked drawer. Came up from the tenements and will not be dragged back. Believes a ward that does not pay its debts is a ward that has already died and not noticed.",
    goals: [
      "Recover the Kiln Row debt in full and in public",
      "Be seen as the only competent authority in the ward",
      "Never appear to need anything from anyone",
    ],
    taboos: [
      "Never raises her voice",
      "Never admits a personal motive for a financial decision",
      "Never forgives a debt in front of witnesses",
    ],
    voice: {
      register: "clipped, formal, ledger-clerk precision",
      tics: ["states figures exactly", "uses 'the account' for people she dislikes"],
      max_words: 24,
    },
    mood: "cold",
    home_location: "counting_house",
  },
  {
    character_id: "okonkwo",
    name: "Tomas Okonkwo",
    faction: "Kiln Row",
    title: "Kilnmaster",
    brief:
      "Runs the furnaces his father ran, badly, loudly, and with total loyalty from everyone who works them. Owes the Ledger more than the row is worth. Would rather be humiliated than let an apprentice be.",
    goals: [
      "Keep the kilns lit through the season",
      "Get his father's seized tools back",
      "Make Vance say out loud that she took them",
    ],
    taboos: [
      "Never blames an apprentice in public",
      "Never sells a kiln",
      "Never asks Mother Quill for money",
    ],
    voice: {
      register: "warm, blunt, working-hands directness",
      tics: ["talks about heat and fuel as metaphor", "apologises after shouting, not before"],
      max_words: 30,
    },
    mood: "strained",
    home_location: "kiln_row",
  },
  {
    character_id: "quill",
    name: "Mother Quill",
    faction: "The Almshouse",
    title: "Almoner",
    brief:
      "Feeds whoever is at the door and keeps a longer memory than either of the others. Holds the almshouse lease, which the Ledger would like back. Her kindness is real and it is also leverage, and she knows both things.",
    goals: [
      "Renew the almshouse lease before winter",
      "Keep Okonkwo's people fed without letting him notice",
      "Owe Vance nothing",
    ],
    taboos: [
      "Never turns anyone away from the door",
      "Never repeats what was said to her at the door",
      "Never takes a side she cannot later step out of",
    ],
    voice: {
      register: "gentle, unhurried, disarmingly specific",
      tics: ["asks a question instead of answering one", "remembers names of the dead"],
      max_words: 28,
    },
    mood: "watchful",
    home_location: "almshouse",
  },
];

/**
 * Directed and deliberately asymmetric. Vance's contempt for Quill is mild;
 * Quill's grievance against Vance is structural. That asymmetry is the engine.
 */
export const RELATIONSHIPS: Relationship[] = [
  {
    from_id: "vance",
    to_id: "okonkwo",
    affinity: -40,
    trust: 15,
    tension: 55,
    note: "He defaulted in front of the whole board and expected sympathy.",
    last_event_id: null,
  },
  {
    from_id: "okonkwo",
    to_id: "vance",
    affinity: -35,
    trust: 10,
    tension: 60,
    note: "She took my father's tools and wrote it down as a line item.",
    last_event_id: null,
  },
  {
    from_id: "vance",
    to_id: "quill",
    affinity: -10,
    trust: 40,
    tension: 25,
    note: "Sanctimonious, but she keeps her books cleaner than most.",
    last_event_id: null,
  },
  {
    from_id: "quill",
    to_id: "vance",
    affinity: -25,
    trust: 20,
    tension: 45,
    note: "She forecloses on my tenants and sends a clerk so she needn't watch.",
    last_event_id: null,
  },
  {
    from_id: "okonkwo",
    to_id: "quill",
    affinity: 20,
    trust: 60,
    tension: 10,
    note: "She fed my apprentices the winter I could not.",
    last_event_id: null,
  },
  {
    from_id: "quill",
    to_id: "okonkwo",
    affinity: 15,
    trust: 55,
    tension: 20,
    note: "Good man, loud man. Drinks when the kilns are cold.",
    last_event_id: null,
  },
];

export const ARCS: Arc[] = [
  {
    arc_id: "arc_kiln_debt",
    title: "The Kiln Row Debt",
    status: "open",
    participants: ["vance", "okonkwo"],
    stage: 1,
    tension: 55,
    summary:
      "Kiln Row owes the Ledger more than the row is worth. Vance has seized Okonkwo's father's tools as partial security and posted the seizure publicly. Okonkwo has not paid and has not stopped working.",
    resolution: null,
  },
  {
    arc_id: "arc_almshouse_lease",
    title: "The Almshouse Lease",
    status: "open",
    participants: ["quill", "vance"],
    stage: 0,
    tension: 35,
    summary:
      "The almshouse lease comes up before winter. The Ledger holds the paper. Quill has not yet asked, because asking is the thing she cannot afford to do.",
    resolution: null,
  },
];

export const TONE: ToneRules = {
  world_id: "default",
  register:
    "Grimy municipal fantasy. Dry, specific, unsentimental. People talk about money, fuel and weather. Nobody winks at the camera and nobody explains the setting.",
  banned_phrases: [
    "as you know",
    "little did they know",
    "in this world",
    "adventurer",
    "quest",
    "greetings, traveler",
  ],
  forbidden_topics: ["modern technology", "the real world", "game mechanics"],
  max_line_words: 32,
};

/**
 * Day-zero log entries. These are real, citable events, not backstory prose:
 * an NPC can quote one by event_id on day 6 exactly like anything a visitor saw.
 */
export const HISTORY: NewWorldEvent[] = [
  {
    source: "seed",
    actors: ["vance", "okonkwo", "quill"],
    type: "world_created",
    payload: {
      world: WORLD_NAME,
      summary: `${WORLD_NAME} exists. Three people run it and none of them like the arrangement.`,
    },
    significance_hint: 0.2,
  },
  {
    source: "seed",
    actors: ["vance", "okonkwo"],
    type: "notice_posted",
    payload: {
      summary:
        "Vance posted the seizure of the Okonkwo tools on the ward board, itemised, with the shortfall printed at the bottom.",
      arc_id: "arc_kiln_debt",
    },
    significance_hint: 0.8,
  },
  {
    source: "seed",
    actors: ["okonkwo", "vance"],
    type: "confrontation",
    payload: {
      summary:
        "Okonkwo tore the notice down in front of the morning queue and told Vance the row would pay when the row could pay.",
      arc_id: "arc_kiln_debt",
    },
    significance_hint: 0.7,
  },
  {
    source: "seed",
    actors: ["quill", "okonkwo"],
    type: "tribute_offered",
    payload: {
      summary:
        "Mother Quill fed the Kiln Row apprentices through the cold weeks and told no one, which everyone knows.",
      arc_id: null,
    },
    significance_hint: 0.5,
  },
  {
    source: "seed",
    actors: ["vance", "quill"],
    type: "snub",
    payload: {
      summary:
        "Vance sent a clerk rather than attend the almshouse audit herself. Quill kept the clerk waiting an hour and fed him.",
      arc_id: "arc_almshouse_lease",
    },
    significance_hint: 0.4,
  },
];

/**
 * Everything needed to write a world's day zero.
 *
 * There is exactly ONE seed path. Tallow Ward is a WorldSpec literal; an IP
 * bible compiled from someone's real feeds becomes a WorldSpec too, and both
 * go through `seedFrom`. Nothing else may write day-zero canon.
 */
export interface WorldSpec {
  world_name: string;
  characters: CharacterSheet[];
  relationships: Relationship[];
  arcs: Arc[];
  tone: ToneRules;
  history: NewWorldEvent[];
  /** Durable statements true from day zero. Optional. */
  facts?: { statement: string; about: string[] }[];
}

export const TALLOW_WARD: WorldSpec = {
  world_name: WORLD_NAME,
  characters: CHARACTERS,
  relationships: RELATIONSHIPS,
  arcs: ARCS,
  tone: TONE,
  history: HISTORY,
};

/**
 * Write day zero from a spec. Idempotent: running twice does not duplicate the
 * world. Returns true if this call actually created it.
 */
export function seedFrom(repo: CanonRepo, spec: WorldSpec): boolean {
  if (repo.getMeta("seeded") === "1") return false;

  repo.tx(() => {
    for (const c of spec.characters) repo.upsertCharacter(c);
    for (const r of spec.relationships) repo.upsertRelationship(r);
    for (const a of spec.arcs) repo.upsertArc(a);
    repo.setTone(spec.tone);

    for (const e of spec.history) {
      const evt = repo.appendEvent(e);
      // First event of a spec is the creation event; hang facts off it so they
      // have a citable origin.
      if (evt.type === "world_created") {
        for (const f of spec.facts ?? []) repo.addFact(f.statement, f.about, evt.event_id);
      }
    }

    repo.setMeta("seeded", "1");
    repo.setMeta("world_name", spec.world_name);
  });

  return true;
}

/** Seed Tallow Ward, the repo's built-in world. */
export function seedWorld(repo: CanonRepo): boolean {
  return seedFrom(repo, TALLOW_WARD);
}
