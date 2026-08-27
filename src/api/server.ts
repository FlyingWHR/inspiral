/**
 * THE MEMORY LAYER.
 *
 * Inspiral as a destination needs its own audience, and audiences are the thing
 * nobody has. Inspiral as a LAYER rides an audience that already exists: a
 * product with recurring events and stakes calls in when something happens, and
 * calls back when it needs to know what the world remembers.
 *
 * Trade Clash is customer one and its contract is already written -- see
 * `IMatchFeed` in tradeclash-platform: MatchId, BotIds, WinnerSide, decided
 * server-side on the authoritative sim tick. One finished match is one
 * `confrontation` in canon, and a season of them is a rivalry nobody authored.
 *
 * Four things this exposes, and nothing else:
 *
 *   POST /v1/matches     something happened          (the webhook)
 *   POST /v1/stakes      somebody took a side        (the retention hook)
 *   GET  /v1/rivalry     what is between these two   (the caster's question)
 *   GET  /v1/mine        what my characters did      (the return trigger)
 *   GET  /v1/memory      what is remembered about X  (the return visit)
 *   GET  /w/<world>      the log, as a page          (the shareable artifact)
 *
 * WHY THE HTML PAGES MATTER MORE THAN THEY LOOK. Every citation this system
 * produces was previously unshareable: clip drafts pointed at a permalink that
 * did not exist. A receipt nobody can open is not evidence, it is a claim with
 * a hex string after it. `/w/<world>/e/<event_id>` is the smallest thing that
 * turns the entire log into something a person can link to.
 *
 * The pages are public on purpose -- that is the point of a permalink. Personal
 * memory and all writes are not: they need the key.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { CanonRepo } from "../canon/repo.js";
import { describeEvent } from "../types/events.js";
import { log } from "../log.js";

export interface MemoryApiOptions {
  repo: CanonRepo;
  port?: number;
  /**
   * Shared secret for writes and for reading anyone's personal history.
   *
   * FAIL CLOSED. With no key configured the server still starts and still
   * serves the public permalinks, but every authenticated route answers 503.
   * An unauthenticated write endpoint on a log whose whole value is that it can
   * be trusted would be worse than no endpoint at all.
   */
  apiKey?: string | undefined;
  /** Base for permalinks in responses. */
  publicUrl?: string;
}

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
  });
  res.end(s);
};

const html = (res: ServerResponse, code: number, body: string): void => {
  res.writeHead(code, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

/**
 * A headline, not a paragraph.
 *
 * describeEvent() returns the full summary, and a Mind writes summaries that
 * run to several sentences of stage direction. Straight into an <h1> that is a
 * wall of text, and into a timeline row it is a paragraph pretending to be a
 * list item. The full prose still appears; it just stops being the title.
 */
const headline = (s: string, max = 96): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(":"));
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[,;:]$/, "")}…`;
};

/** Escape before anything from canon reaches a page. */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

async function readJson(req: IncomingMessage, limitBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    // A webhook body is small. Anything else is a mistake or an attack.
    if (size > limitBytes) throw new Error("body too large");
    chunks.push(b);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const str = (v: unknown, max = 64): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};

export class MemoryApi {
  private http?: Server;
  private readonly repo: CanonRepo;
  private readonly port: number;
  private readonly apiKey: string | undefined;
  private readonly publicUrl: string;

  constructor(opts: MemoryApiOptions) {
    this.repo = opts.repo;
    this.port = opts.port ?? 8790;
    this.apiKey = opts.apiKey;
    this.publicUrl = (opts.publicUrl ?? `http://localhost:${opts.port ?? 8790}`).replace(/\/+$/, "");
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  private world(): string {
    return this.repo.getMeta("world_name") ?? "the world";
  }

  private worldSlug(): string {
    return this.world().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  private permalink(eventId: string): string {
    return `${this.publicUrl}/w/${this.worldSlug()}/e/${eventId}`;
  }

  /** Constant-time-ish check. Returns an error string, or null if allowed. */
  private denied(req: IncomingMessage): string | null {
    if (!this.apiKey) return "no INSPIRAL_API_KEY configured; authenticated routes are closed";
    const got = req.headers["x-inspiral-key"];
    return got === this.apiKey ? null : "bad or missing X-Inspiral-Key";
  }

  async open(): Promise<void> {
    this.http = createServer((req, res) => {
      void this.route(req, res).catch((e) => {
        log.warn(`api: ${(e as Error).message}`);
        if (!res.headersSent) json(res, 400, { error: (e as Error).message });
      });
    });
    await new Promise<void>((r) => this.http!.listen(this.port, r));
    log.info(
      `memory api: ${this.url}` +
        (this.apiKey ? "" : "  (NO API KEY -- public pages only, writes closed)"),
    );
  }

  async close(): Promise<void> {
    if (this.http) await new Promise<void>((r) => this.http!.close(() => r()));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    // ---- public: the shareable artifacts -----------------------------------
    const receipt = /^\/w\/[^/]+\/e\/([A-Za-z0-9_]{1,64})$/.exec(path);
    if (method === "GET" && receipt) return this.pageReceipt(res, receipt[1]!);
    if (method === "GET" && /^\/w\/[^/]+$/.test(path)) return this.pageTimeline(res);

    // ---- authenticated ------------------------------------------------------
    const deny = this.denied(req);
    if (method === "POST" && path === "/v1/matches") {
      if (deny) return json(res, this.apiKey ? 401 : 503, { error: deny });
      return this.postMatch(res, await readJson(req));
    }
    if (method === "POST" && path === "/v1/stakes") {
      if (deny) return json(res, this.apiKey ? 401 : 503, { error: deny });
      return this.postStake(res, await readJson(req));
    }
    if (method === "GET" && path === "/v1/rivalry") {
      if (deny) return json(res, this.apiKey ? 401 : 503, { error: deny });
      return this.getRivalry(res, url);
    }
    if (method === "GET" && path === "/v1/mine") {
      if (deny) return json(res, this.apiKey ? 401 : 503, { error: deny });
      return this.getMine(res, url);
    }
    if (method === "GET" && path === "/v1/memory") {
      if (deny) return json(res, this.apiKey ? 401 : 503, { error: deny });
      return this.getMemory(res, url);
    }

    json(res, 404, { error: `no route for ${method} ${path}` });
  }

  // -------------------------------------------------------------------------
  // WRITES
  // -------------------------------------------------------------------------

  /**
   * A match finished. `winner_side` is 0 = A, 1 = B, -1 = draw, matching
   * IMatchFeed exactly so the caller does not have to translate.
   *
   * IDEMPOTENT ON match_id, because webhooks retry and a retried match that
   * moved the rivalry twice would silently inflate a grudge. The whole product
   * is that the log is trustworthy; double-counting is the cheapest way to lose
   * that and the easiest to miss.
   */
  private postMatch(res: ServerResponse, body: unknown): void {
    const b = body as Record<string, unknown>;
    const matchId = str(b.match_id);
    const a = str(b.bot_a);
    const c = str(b.bot_b);
    const side = b.winner_side;

    if (!matchId || !a || !c) {
      return json(res, 400, { error: "match_id, bot_a and bot_b are required" });
    }
    if (side !== 0 && side !== 1 && side !== -1) {
      return json(res, 400, { error: "winner_side must be 0 (A), 1 (B) or -1 (draw)" });
    }
    if (a === c) return json(res, 400, { error: "a bot cannot fight itself" });

    const seen = `match:${matchId}`;
    const already = this.repo.getMeta(seen);
    if (already) {
      return json(res, 200, {
        status: "already recorded",
        event_id: already,
        permalink: this.permalink(already),
      });
    }

    for (const id of [a, c]) {
      if (!this.repo.characterExists(id)) {
        return json(res, 422, {
          error: `unknown character '${id}'. Onboard the cast before reporting matches.`,
        });
      }
    }

    const draw = side === -1;
    const winner = side === 0 ? a : c;
    const loser = side === 0 ? c : a;

    const event = this.repo.appendEvent({
      source: "host",
      actors: draw ? [a, c] : [winner, loser],
      type: draw ? "concession" : "confrontation",
      payload: {
        summary: draw
          ? `${a} and ${c} fought to a draw.`
          : `${winner} beat ${loser}.`,
        match_id: matchId,
        origin: "trade_clash",
      },
      significance_hint: draw ? 0.4 : 0.7,
    });
    this.repo.setMeta(seen, event.event_id);

    // Losing to someone moves how you see them. Drawing barely does.
    if (!draw) {
      this.repo.adjustRelationship(
        loser,
        winner,
        { affinity: -6, tension: +12, note: `Lost to ${winner} in ${matchId}.` },
        event.event_id,
      );
      this.repo.adjustRelationship(
        winner,
        loser,
        { affinity: -2, tension: +6, note: `Beat ${loser} in ${matchId}.` },
        event.event_id,
      );
    }

    json(res, 201, {
      status: "recorded",
      event_id: event.event_id,
      permalink: this.permalink(event.event_id),
    });
  }

  /**
   * Somebody put something behind a bot. This is the retention hook: it is the
   * moment a viewer stops being traffic and becomes someone with a stake, and
   * it is the only thing that makes a later "I remember what you did" true.
   */
  private postStake(res: ServerResponse, body: unknown): void {
    const b = body as Record<string, unknown>;
    const fan = str(b.fan_id);
    const bot = str(b.bot_id);
    const weight = typeof b.weight === "number" ? b.weight : 12;

    if (!fan || !bot) return json(res, 400, { error: "fan_id and bot_id are required" });
    if (!this.repo.characterExists(bot)) {
      return json(res, 422, { error: `unknown character '${bot}'` });
    }
    if (!Number.isFinite(weight) || weight < 1 || weight > 40) {
      return json(res, 400, { error: "weight must be between 1 and 40" });
    }

    this.repo.ensureVisitor(fan, str(b.display_name, 120) ?? "");
    const event = this.repo.appendEvent({
      source: "visitor",
      actors: [`fan:${fan}`, bot],
      type: "visitor_pledged",
      payload: { summary: `Backed ${bot}.`, match_id: str(b.match_id) ?? undefined },
      significance_hint: 0.6,
    });

    const sentiment = this.repo.adjustStance(fan, bot, weight);
    this.repo.addInteraction(fan, {
      event_id: event.event_id,
      ts: event.ts,
      character_id: bot,
      kind: "pledge",
      detail: `backed ${bot}`,
    });
    // Witnessed by the bot they backed, so only that bot may bring it up later.
    this.repo.addMoment(fan, {
      event_id: event.event_id,
      ts: event.ts,
      summary: `Backed ${bot} when it counted.`,
      weight: 0.7,
      witnesses: [bot],
    });

    json(res, 201, {
      status: "recorded",
      event_id: event.event_id,
      stance: sentiment,
      permalink: this.permalink(event.event_id),
    });
  }

  // -------------------------------------------------------------------------
  // READS
  // -------------------------------------------------------------------------

  /**
   * What is between these two, with receipts. This is the question a live
   * caster actually has: "have these two met before, and how did it go?"
   */
  private getRivalry(res: ServerResponse, url: URL): void {
    const a = str(url.searchParams.get("a"));
    const b = str(url.searchParams.get("b"));
    if (!a || !b) return json(res, 400, { error: "a and b are required" });

    const meetings = this.repo
      .eventsInvolving(a, 200)
      .filter((e) => e.actors.includes(b))
      .filter((e) => e.type === "confrontation" || e.type === "concession");

    const wins = (x: string): number =>
      meetings.filter((e) => e.type === "confrontation" && e.actors[0] === x).length;

    const edge = this.repo.getRelationship(a, b);
    json(res, 200, {
      a,
      b,
      met: meetings.length,
      record: { [a]: wins(a), [b]: wins(b), draws: meetings.filter((e) => e.type === "concession").length },
      feeling: edge
        ? { affinity: edge.affinity, tension: edge.tension, note: edge.note }
        : null,
      // Every claim above is one of these. None of it is generated.
      receipts: meetings.slice(-8).map((e) => ({
        event_id: e.event_id,
        ts: e.ts,
        summary: describeEvent(e),
        permalink: this.permalink(e.event_id),
      })),
    });
  }

  /**
   * WHAT DID THE CHARACTER I MADE DO WHILE I WAS GONE.
   *
   * This is the return trigger, and it is a better one than "does an NPC
   * remember me". Being remembered is flattery and you cannot tell in advance
   * whether it will be any good. A character you authored, out in a world that
   * kept running without you, is CURIOSITY -- you want to know what it did the
   * way you want to know how a bet went.
   *
   * Ownership is read straight out of the log: the mint event carries
   * `fan:<owner>` beside the character, so nothing here can disagree with
   * history, and every line comes back with a permalink.
   */
  private getMine(res: ServerResponse, url: URL): void {
    const fan = str(url.searchParams.get("fan"));
    if (!fan) return json(res, 400, { error: "fan is required" });

    const mine = this.repo
      .eventsInvolving(`fan:${fan}`, 200)
      .filter((e) => e.type === "character_minted")
      .map((e) => e.actors.find((a) => !a.startsWith("fan:")))
      .filter((id): id is string => Boolean(id));

    json(res, 200, {
      fan_id: fan,
      characters: mine.map((id) => {
        const sheet = this.repo.getCharacter(id);
        // Their own mint is not news to the person who did it.
        const did = this.repo
          .eventsInvolving(id, 40)
          .filter((e) => e.type !== "character_minted")
          .slice(0, 8);
        return {
          character_id: id,
          name: sheet?.name ?? id,
          faction: sheet?.faction ?? "",
          mood: sheet?.mood ?? "",
          since_you_left: did.map((e) => ({
            event_id: e.event_id,
            ts: e.ts,
            summary: describeEvent(e),
            permalink: this.permalink(e.event_id),
          })),
        };
      }),
    });
  }

  /** What this world remembers about one person, and how it knows. */
  private getMemory(res: ServerResponse, url: URL): void {
    const fan = str(url.searchParams.get("fan"));
    if (!fan) return json(res, 400, { error: "fan is required" });

    const record = this.repo.getVisitor(fan);
    if (!record) return json(res, 404, { error: `never met '${fan}'` });

    const moments = this.repo.recallMoments(fan, undefined, 8);
    json(res, 200, {
      fan_id: fan,
      display_name: record.display_name,
      first_seen: record.first_seen,
      last_seen: record.last_seen,
      // Asserted, not authenticated. Said here so a caller cannot mistake it.
      identity: "asserted",
      stance: this.repo.getStance(fan),
      remembers: moments.map((m) => ({
        event_id: m.event_id,
        ts: m.ts,
        summary: m.summary,
        who_saw_it: m.witnesses,
        permalink: this.permalink(m.event_id),
      })),
    });
  }

  // -------------------------------------------------------------------------
  // PUBLIC PAGES -- the whole reason a citation is worth anything
  // -------------------------------------------------------------------------

  private page(title: string, body: string): string {
    return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--ink:#16130f;--dim:#6b6257;--line:#e0d9cd;--bg:#faf7f2}
@media(prefers-color-scheme:dark){:root{--ink:#f2ece1;--dim:#a89f8f;--line:#2c2822;--bg:#131110}}
*{box-sizing:border-box}
body{margin:0;padding:2.5rem 1.25rem;background:var(--bg);color:var(--ink);
 font:16px/1.6 ui-serif,Georgia,serif;display:flex;justify-content:center}
main{width:100%;max-width:38rem}
h1{font-size:1.5rem;margin:0 0 .25rem;line-height:1.25}
.sub{color:var(--dim);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 2rem}
li{list-style:none;padding:.85rem 0;border-top:1px solid var(--line)}
ul{padding:0;margin:0}
time{color:var(--dim);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;display:block}
a{color:inherit}
.id{color:var(--dim);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line);
 color:var(--dim);font-size:13px}
</style>
<main>${body}</main>`;
  }

  /** One event, permanently addressable. The thing a citation points at. */
  private pageReceipt(res: ServerResponse, eventId: string): void {
    const e = this.repo.getEvent(eventId);
    if (!e) {
      return html(
        res,
        404,
        this.page("Not in the log", `<h1>Not in the log</h1><p class="sub">${esc(eventId)}</p>
<p>No event with that id. Nothing here is generated on demand — if it is not in
the append-only log, it did not happen.</p>`),
      );
    }
    const cast = e.actors.map((a) => esc(this.repo.getCharacter(a)?.name ?? a)).join(" &middot; ");
    const full = describeEvent(e);
    const short = headline(full);
    html(
      res,
      200,
      this.page(
        short,
        `<h1>${esc(short)}</h1>
<p class="sub"><time>${esc(e.ts)}</time>${esc(e.type)} &middot; ${cast}</p>
${short === full ? "" : `<p>${esc(full)}</p>`}
<p class="id">${esc(e.event_id)}</p>
<footer>From the append-only log of <a href="/w/${esc(this.worldSlug())}">${esc(this.world())}</a>.
This record cannot be edited or deleted — the database refuses both.</footer>`,
      ),
    );
  }

  /** The world's history, newest first. Every line links to its own receipt. */
  private pageTimeline(res: ServerResponse): void {
    const events = this.repo.recentEvents(120).reverse();
    const rows = events
      .map(
        (e) =>
          `<li><time>${esc(e.ts)}</time>
<a href="/w/${esc(this.worldSlug())}/e/${esc(e.event_id)}">${esc(headline(describeEvent(e), 120))}</a></li>`,
      )
      .join("\n");
    html(
      res,
      200,
      this.page(
        this.world(),
        `<h1>${esc(this.world())}</h1>
<p class="sub">${events.length} of ${this.repo.allEvents().length} events &middot; append-only</p>
<ul>${rows}</ul>
<footer>Every line is addressable and none of it is generated on demand.</footer>`,
      ),
    );
  }
}
