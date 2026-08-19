import type { CanonRepo } from "../canon/repo.js";
import type { EventType, NewWorldEvent, WorldEvent } from "../types/events.js";
import type { IPSource, RawItem, RawItemKind } from "./source.js";
import { log } from "../log.js";

/**
 * INGESTION: the owner's real feed becomes the world's news.
 *
 * "You post something real, it's the talk of the world an hour later."
 * Mechanically that is: new item -> ONE event in the append-only log, in the
 * EXISTING schema, plus a bounded nudge to the relationship it concerns. The
 * digest already reads the log and the tick loop already reads the digest, so
 * nothing new has to be wired to make the cast notice.
 *
 * COST: zero host invocations. Not "one cheap one" -- zero. Ingestion is
 * mechanical normalisation; the narrative decision still happens once per tick,
 * where it is budgeted. A per-item Mind call would make cost scale with how
 * often the owner posts, which is the wrong curve and the whole reason this
 * layer is dumb on purpose.
 */

export const INGEST_CURSOR_KEY = "ingest_cursor";
const SEEN_PREFIX = "ingested:";

/**
 * Raw kinds onto the CLOSED event vocabulary. There is no "social_post" event
 * type and there must not be: the cast can only reason about actions it already
 * knows how to hold against someone.
 *
 *   post / pinned / video -> notice_posted   it is on the world's board now
 *   comment               -> rumor_spread    it travelled without being said
 *   match                 -> confrontation   two blocs met and one of them lost
 *   profile               -> (not an event)  it is bible material, not news
 */
export const KIND_EVENT_TYPE: Record<RawItemKind, EventType | null> = {
  profile: null,
  post: "notice_posted",
  pinned: "notice_posted",
  video: "notice_posted",
  comment: "rumor_spread",
  match: "confrontation",
};

/** Default temperature change when an item names two cast members. */
const DEFAULT_TENSION = 12;

/** What the reacting character will say about it. Their words are capped later. */
function noteFrom(item: RawItem): string {
  const t = item.text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
}

/**
 * One item -> one event, or undefined if this kind is not news.
 * `cast` filters actors: an item naming someone who is not in the world would
 * fail referential validation everywhere downstream.
 */
export function itemToEvent(item: RawItem, cast: string[]): NewWorldEvent | undefined {
  const type = KIND_EVENT_TYPE[item.kind];
  if (!type) return undefined;

  const named = (item.actors ?? []).filter((a) => cast.includes(a));
  // Unattributed items still belong to someone: the owner's world speaks with
  // the first voice in the cast unless the item says otherwise.
  const actors = named.length ? named : cast.slice(0, 1);
  if (actors.length === 0) return undefined;

  return {
    source: "ingest",
    ts: item.ts,
    actors,
    type,
    payload: {
      summary: noteFrom(item),
      item_id: item.item_id,
      item_kind: item.kind,
      author: item.author,
      from_ip: true,
      ...(item.url ? { url: item.url } : {}),
      ...(item.arc_id ? { arc_id: item.arc_id } : {}),
    },
    significance_hint: item.significance ?? 0.5,
  };
}

/**
 * Record items as already accounted for without writing events.
 *
 * Onboarding turns the back catalogue into day-zero canon; without this the
 * same items would come back through the poll loop as breaking news the first
 * time the cursor is lost or wound back.
 */
export function markIngested(repo: CanonRepo, items: RawItem[]): void {
  for (const i of items) repo.setMeta(`${SEEN_PREFIX}${i.item_id}`, i.ts);
}

export interface IngestResult {
  /** Events actually written, oldest first. */
  ingested: WorldEvent[];
  /** Items seen before, or of a kind that is not news. */
  skipped: number;
  cursor: string | undefined;
}

/**
 * Pull once and write what is new.
 *
 * The relationship nudge is what makes the claim true rather than decorative.
 * When an item names two cast members, the second one's view of the first moves
 * -- and `last_event_id` is set to THIS event. The character runtime already
 * quotes `note` and cites `last_event_id` when a character acts against someone
 * they have history with, so on the next tick the cast repeats the post and
 * cites it. No new rendering path, no host call, no invented schema.
 */
export async function ingestOnce(
  repo: CanonRepo,
  source: IPSource,
  opts: { since?: string } = {},
): Promise<IngestResult> {
  const cursor = opts.since ?? repo.getMeta(INGEST_CURSOR_KEY);
  const items = await source.fetch(cursor ? { since: cursor } : {});
  const cast = repo.getCharacters().map((c) => c.character_id);

  const ingested: WorldEvent[] = [];
  let skipped = 0;
  let newest = cursor;

  for (const item of items) {
    if (repo.getMeta(`${SEEN_PREFIX}${item.item_id}`)) {
      skipped++;
      continue;
    }
    const draft = itemToEvent(item, cast);
    if (!draft) {
      repo.setMeta(`${SEEN_PREFIX}${item.item_id}`, item.ts);
      skipped++;
      continue;
    }

    const event = repo.tx(() => {
      const e = repo.appendEvent(draft);
      const [subject, ...reactors] = draft.actors;

      for (const reactor of reactors) {
        repo.adjustRelationship(
          reactor,
          subject!,
          {
            tension: item.impact?.tension ?? DEFAULT_TENSION,
            ...(item.impact?.affinity !== undefined ? { affinity: item.impact.affinity } : {}),
            ...(item.impact?.trust !== undefined ? { trust: item.impact.trust } : {}),
            note: noteFrom(item),
          },
          e.event_id,
        );
      }

      // Threading it onto an open arc is what gets the tick loop to act on it
      // rather than merely list it.
      const arc = item.arc_id ? repo.getArc(item.arc_id) : undefined;
      if (arc && arc.status !== "resolved") {
        repo.upsertArc({
          ...arc,
          tension: Math.max(0, Math.min(100, arc.tension + (item.impact?.tension ?? DEFAULT_TENSION))),
          summary: `${arc.summary} ${noteFrom(item)}`.trim().slice(0, 2000),
        });
      }

      repo.setMeta(`${SEEN_PREFIX}${item.item_id}`, item.ts);
      return e;
    });

    ingested.push(event);
    if (!newest || item.ts > newest) newest = item.ts;
  }

  if (newest) repo.setMeta(INGEST_CURSOR_KEY, newest);
  if (ingested.length) log.info(`ingested ${ingested.length} item(s) from ${source.name}`);

  return { ingested, skipped, cursor: newest };
}

export interface IngestLoopOptions {
  intervalMs?: number;
  onBatch?: (r: IngestResult) => void | Promise<void>;
}

/**
 * Poll until stopped. The timer is unref'd, so this never keeps a process alive
 * on its own -- the caller decides what the process is for.
 */
export function ingestLoop(
  repo: CanonRepo,
  source: IPSource,
  opts: IngestLoopOptions = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  let running = false;

  const pull = async (): Promise<void> => {
    if (running) return; // a slow source must not stack up overlapping pulls
    running = true;
    try {
      const r = await ingestOnce(repo, source);
      if (r.ingested.length || r.skipped) await opts.onBatch?.(r);
    } catch (e) {
      log.warn(`ingest from ${source.name} failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };

  void pull();
  const timer = setInterval(() => void pull(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
