/**
 * PIECES OVER HTTP.
 *
 * A sibling of `MemoryApi`, not more routes inside it. The memory layer serves
 * a different product (matches, rivalries, stakes) to a different caller, and
 * the pivot that keeps pieces should be able to delete that file without
 * unpicking these routes from it. Same conventions, same helpers, same
 * fail-closed rule -- just a second door.
 *
 * The helpers below (json/html/esc/readJson/str) are deliberate copies of the
 * ones in `src/api/server.ts`. They are private there, and a shared
 * `src/api/http.ts` would mean editing a file this module has no business
 * editing. Forty lines duplicated beats a refactor of a working server.
 *
 *   GET  /v1/pieces                open pieces                       (key)
 *   GET  /v1/pieces/:id            piece + lineage                   (key)
 *   POST /v1/pieces/:id/extend     somebody builds on somebody       (key)
 *   GET  /v1/waiting?fan=          the return screen                 (key)
 *   GET  /w/<room>/p/<piece_id>    the piece, as a page              (no key)
 *
 * The public page is the point. A piece is a thing several people made and
 * somebody wants to show it to a fourth person; a link that needs a key is not
 * a thing you can show anybody. Every line on it resolves to a receipt, so the
 * attribution is checkable and not merely claimed.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, resolve, sep } from "node:path";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
import type { CanonRepo } from "../canon/repo.js";
import { log } from "../log.js";
import {
  BODY_MAX,
  BODY_MIN,
  type Extension,
  type ExtendResponse,
  type PieceWithLineage,
} from "./contract.js";
import {
  ExtendError,
  extendPiece,
  getPiece,
  lineage,
  listPieces,
  markSeen,
  parentAuthor,
  placePiece,
  seedPiece,
  waitingFor,
} from "./repo.js";
import type { HostRuntime } from "../host/HostRuntime.js";
import { narrateChange, routeVisitor } from "./host.js";
import { LiveHub } from "./live.js";
import { creatorDigest, renderDigest } from "./digest.js";
import { enqueue, preferencesFor, setPreference, unsubscribe } from "../notify/dispatch.js";
import { health, stats } from "../ops/health.js";
import { AuthError, identify, mayActAs, signOut, startClaim, verifyClaim } from "../auth/index.js";
import type { NotifyChannel } from "../notify/contract.js";
import {
  ModerationError,
  extendRate,
  hide,
  isHidden,
  report,
  reportsOn,
  withoutHidden,
} from "./moderation.js";

export interface PiecesApiOptions {
  repo: CanonRepo;
  port?: number;
  /**
   * Shared secret. FAIL CLOSED: with no key configured the server still starts
   * and still serves the public piece pages, but every authenticated route
   * answers 503. An open write endpoint on a log whose entire value is that its
   * attribution can be trusted would be worse than no endpoint at all.
   */
  apiKey?: string | undefined;
  /** Base for permalinks in responses. */
  publicUrl?: string;
  /**
   * Static app root, served at `/`. ONE ORIGIN ON PURPOSE.
   *
   * A static page has nowhere to keep an API key, and receipt links pointing at
   * a second server on a second port 404 for anyone who follows them. Serving
   * the app and the API from the same place removes both problems at once
   * instead of inventing a token-passing scheme for a thing that does not need
   * one yet.
   */
  webRoot?: string;
  /**
   * Optional. Without it every extension lands without its sentence, which is
   * the whole payload -- the work is stored, and the person waiting is told
   * only that somebody touched it. Runnable, and not the product.
   */
  host?: HostRuntime | undefined;
  /**
   * Channels used to deliver a claim code. The same ones that deliver
   * notifications: a person has already said how to reach them, so proving
   * they control that address needs no new mechanism.
   */
  channels?: NotifyChannel[];
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

/** Escape before anything from canon reaches a page. */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * 16KB, not 64KB. A body is capped at BODY_MAX characters, so anything an order
 * of magnitude past that is a mistake or an attack and there is no reason to
 * buffer it before finding out.
 */
async function readJson(req: IncomingMessage, limitBytes = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > limitBytes) throw new Error("body too large");
    chunks.push(b);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** `Authorization: Bearer <token>`, if present. */
const bearer = (req: IncomingMessage): string | undefined => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
};

const str = (v: unknown, max = 64): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};


/**
 * How a refusal from the repo becomes a status code.
 *
 * None of these are 500s. Every one of them is a caller holding a stale id or a
 * finished piece, which is an ordinary thing for a caller to do -- a 500 would
 * say the server broke and send them to look in the wrong place.
 */
const STATUS: Record<ExtendError["code"], number> = {
  no_piece: 404,
  no_parent: 404, // the parent id is a URL-ish thing that does not resolve
  wrong_piece: 400, // a well-formed id in the wrong lineage: bad request, not a race
  closed: 409, // the request was fine; the world moved. Retrying elsewhere is the fix
  too_short: 400,
  too_long: 400,
};

export class PiecesApi {
  private http?: Server;
  private readonly repo: CanonRepo;
  private readonly port: number;
  private readonly apiKey: string | undefined;
  private readonly host: HostRuntime | undefined;
  private readonly webRoot: string | undefined;
  private readonly channels: NotifyChannel[];
  /**
   * Presence and the live feed. In-memory and lost on restart, deliberately:
   * presence is transient and canon is permanent, and filling an append-only
   * log with "ada is looking at this" buries the rows worth citing.
   */
  private readonly live = new LiveHub();
  private readonly publicUrl: string;

  constructor(opts: PiecesApiOptions) {
    this.repo = opts.repo;
    this.port = opts.port ?? 8792;
    this.apiKey = opts.apiKey;
    this.host = opts.host;
    this.webRoot = opts.webRoot;
    this.channels = opts.channels ?? [];
    this.publicUrl = (opts.publicUrl ?? `http://localhost:${opts.port ?? 8792}`).replace(/\/+$/, "");
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

  /**
   * Byte-identical to MemoryApi's, and that is the requirement rather than a
   * coincidence: the receipts these links point at are served over there.
   */
  private permalink(eventId: string): string {
    return `${this.publicUrl}/w/${this.worldSlug()}/e/${eventId}`;
  }

  /**
   * Oldest-first ordering is guaranteed by `lineage()` itself. Hidden work is
   * dropped HERE so every reader of a lineage gets the same answer -- a
   * takedown that only applied to one of three read paths is not a takedown.
   */
  private lineage(pieceId: string): PieceWithLineage | undefined {
    const full = lineage(this.repo, pieceId);
    return full ? withoutHidden(this.repo, full) : undefined;
  }

  /** Returns an error string, or null if allowed. */
  private denied(req: IncomingMessage): string | null {
    if (!this.apiKey) return "no INSPIRAL_API_KEY configured; authenticated routes are closed";
    const got = req.headers["x-inspiral-key"];
    return got === this.apiKey ? null : "bad or missing X-Inspiral-Key";
  }

  async open(): Promise<void> {
    this.http = createServer((req, res) => {
      void this.route(req, res).catch((e) => {
        log.warn(`pieces api: ${(e as Error).message}`);
        if (!res.headersSent) json(res, 400, { error: (e as Error).message });
      });
    });
    await new Promise<void>((r) => this.http!.listen(this.port, r));
    log.info(
      `pieces api: ${this.url}` +
        (this.apiKey ? "" : "  (NO API KEY -- public pages only, writes closed)"),
    );
  }

  async close(): Promise<void> {
    /**
     * LIVE FIRST, THEN THE SERVER, and the order is not cosmetic. An open SSE
     * response is an open connection, and `server.close()` waits for every one
     * of them -- so closing the http server first means its callback never
     * fires and the process hangs on exit forever.
     */
    this.live.close();
    if (this.http) await new Promise<void>((r) => this.http!.close(() => r()));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    // ---- public: the shareable artefacts -----------------------------------
    const page = /^\/w\/[^/]+\/p\/([A-Za-z0-9_]{1,64})$/.exec(path);
    if (method === "GET" && page) return this.pagePiece(res, page[1]!);

    /**
     * The receipt for a single extension. Served HERE and not only by
     * MemoryApi, because every lineage entry links to one: pointing them at a
     * different server on a different port meant every link on the shareable
     * page 404'd for whoever followed it.
     */
    const receipt = /^\/w\/[^/]+\/e\/([A-Za-z0-9_]{1,64})$/.exec(path);
    if (method === "GET" && receipt) return this.pageReceipt(res, receipt[1]!);

    /**
     * PUBLIC. Claiming an id is how somebody BECOMES known, so it cannot sit
     * behind the credential it hands out. Rate limiting lives in the code
     * budget and the single-use rule rather than in the router.
     */
    const auth = /^\/v1\/auth\/(claim|verify|signout)$/.exec(path);
    if (method === "POST" && auth) {
      const b = (await readJson(req)) as Record<string, unknown>;
      try {
        if (auth[1] === "claim") {
          return json(res, 200, await startClaim(this.repo, this.channels, {
            fan_id: String(b.fan_id ?? ""),
            channel: String(b.channel ?? "console"),
            address: String(b.address ?? ""),
          }));
        }
        if (auth[1] === "verify") {
          const out = verifyClaim(this.repo, {
            fan_id: String(b.fan_id ?? ""), code: String(b.code ?? ""),
          });
          return json(res, 200, out);
        }
        const token = bearer(req) ?? String(b.token ?? "");
        return json(res, 200, { revoked: signOut(this.repo, { token }) });
      } catch (e) {
        if (e instanceof AuthError) {
          const code = e.code === "too_many" ? 429 : e.code === "no_channel" ? 400 : 400;
          return json(res, code, { error: e.message, code: e.code });
        }
        throw e;
      }
    }

    /**
     * PUBLIC, and it has to be: a health check behind auth is useless to the
     * load balancer that is meant to read it. Cheap enough to poll -- one
     * SELECT 1 and one writability probe, no host call, no log scan.
     */
    if (method === "GET" && path === "/health") {
      const h = health(this.repo);
      return json(res, h.ok ? 200 : 503, h);
    }

    /**
     * The live feed is PUBLIC because the piece pages are. A feed that needed a
     * key to watch a page anybody can read would be a lock on the wrong door.
     */
    if (method === "GET" && path === "/v1/live") {
      return this.live.subscribe(res, { piece: url.searchParams.get("piece") });
    }

    // ---- authenticated ------------------------------------------------------
    const deny = this.denied(req);
    const closed = (): void => void json(res, this.apiKey ? 401 : 503, { error: deny });

    if (method === "GET" && path === "/v1/pieces") {
      if (deny) return closed();
      return json(res, 200, { pieces: listPieces(this.repo, "open") });
    }
    if (method === "GET" && path === "/v1/waiting") {
      if (deny) return closed();
      return this.getWaiting(res, url);
    }

    /**
     * WHERE SHOULD I START. The Mind's judgement, exposed.
     *
     * Not a sort: the right piece is rarely the newest or the busiest, it is
     * one this person can add to and ideally one somebody is waiting on. Falls
     * back to the thinnest open piece when the host is down, so a frontend
     * always gets an answer and never has to handle "no suggestion".
     */
    if (method === "GET" && path === "/v1/route") {
      if (deny) return closed();
      const fan = str(url.searchParams.get("fan")) ?? "";
      const open = listPieces(this.repo, "open");
      const history = fan
        ? this.repo
            .eventsInvolving(`fan:${fan}`, 50)
            .filter((e) => e.type === "piece_extended")
            .slice(0, 8)
            .map((e) => {
              const p = e.payload as Record<string, unknown>;
              return { piece_id: String(p.piece_id ?? ""), body: String(p.body ?? ""), ts: e.ts };
            })
        : [];
      const chosen = await routeVisitor(this.host, {
        fan_id: fan,
        history,
        pieces: open.map((p) => ({
          piece_id: p.piece_id, title: p.title, brief: p.brief,
          generation: p.generation, last_ts: p.updated_ts,
        })),
      });
      return json(res, 200, chosen ?? { piece_id: null, because: "Nothing is open yet." });
    }

    /**
     * THE WHOLE SPACE IN ONE CALL, so a spatial frontend can draw a room
     * without N requests. `generation` is depth: a piece twelve deep should not
     * look like one that is one deep. Still never a ranking.
     */
    /**
     * WHAT THE CREATOR READS INSTEAD OF EVERYTHING. `?format=text` for the
     * rendered note; JSON otherwise, so a frontend can lay it out itself.
     */
    /**
     * WHERE TO REACH ME, AND WHETHER TO. Opting out is one call, and the
     * dispatcher honours it before it even composes a message.
     */
    if (path === "/v1/notify/prefs") {
      if (deny) return closed();
      if (method === "GET") {
        const fan = str(url.searchParams.get("fan"));
        if (!fan) return json(res, 400, { error: "fan is required" });
        return json(res, 200, { fan_id: fan, preferences: preferencesFor(this.repo, fan) });
      }
      if (method === "POST") {
        const b = (await readJson(req)) as Record<string, unknown>;
        const fan = str(b.fan_id);
        const channel = str(b.channel, 40);
        const address = str(b.address, 500);
        if (!fan || !channel || !address) {
          return json(res, 400, { error: "fan_id, channel and address are required" });
        }
        setPreference(this.repo, {
          fan_id: fan, channel, address,
          enabled: b.enabled !== false,
          ...(typeof b.quiet_minutes === "number" ? { quiet_minutes: b.quiet_minutes } : {}),
        });
        return json(res, 200, { preferences: preferencesFor(this.repo, fan) });
      }
      if (method === "DELETE") {
        const fan = str(url.searchParams.get("fan"));
        if (!fan) return json(res, 400, { error: "fan is required" });
        unsubscribe(this.repo, fan, str(url.searchParams.get("channel"), 40) ?? undefined);
        return json(res, 200, { fan_id: fan, preferences: preferencesFor(this.repo, fan) });
      }
    }

    if (method === "GET" && path === "/v1/stats") {
      if (deny) return closed();
      return json(res, 200, stats(this.repo, { subscribers: this.live.subscribers }));
    }

    if (method === "GET" && path === "/v1/digest") {
      if (deny) return closed();
      /**
       * `Number(x) || 24` swallowed a legitimate 0 and silently reported a
       * whole day instead of an empty window -- the classic `||` bug, and a
       * bad one here because "nothing happened" is a real answer this product
       * is supposed to be able to give.
       */
      const raw = Number(url.searchParams.get("hours") ?? NaN);
      const hours = Number.isFinite(raw) && raw >= 0 ? raw : 24;
      const d = await creatorDigest(this.repo, this.host, { hours });
      if (url.searchParams.get("format") === "text") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return void res.end(renderDigest(d));
      }
      return json(res, 200, d);
    }

    const mod = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})\/(report|hide|reports)$/.exec(path);
    if (mod) {
      if (deny) return closed();
      try {
        if (method === "GET" && mod[2] === "reports") {
          return json(res, 200, { reports: reportsOn(this.repo, mod[1]!) });
        }
        const body = (await readJson(req)) as Record<string, unknown>;
        if (method === "POST" && mod[2] === "report") {
          const fan = str(body.fan_id);
          const ev = str(body.event_id);
          if (!fan || !ev) return json(res, 400, { error: "fan_id and event_id are required" });
          return json(res, 201, report(this.repo, {
            fan_id: fan, event_id: ev, reason: String(body.reason ?? ""),
          }));
        }
        if (method === "POST" && mod[2] === "hide") {
          /**
           * The API key IS creator authority here. There is no second role
           * system, and inventing one before a real creator has asked for
           * moderators would be inventing a permission model on spec.
           */
          const ev = str(body.event_id);
          if (!ev) return json(res, 400, { error: "event_id is required" });
          return json(res, 200, hide(this.repo, ev, str(body.by, 64) ?? "creator"));
        }
      } catch (e) {
        if (e instanceof ModerationError) {
          const code = e.code === "no_event" ? 404 : 400;
          return json(res, code, { error: e.message, code: e.code });
        }
        throw e;
      }
    }

    if (method === "GET" && path === "/v1/space") {
      if (deny) return closed();
      return json(res, 200, this.live.spaceView(this.world(), listPieces(this.repo, "open")));
    }

    /**
     * Placement is the SPACE's decision, not the creator's -- a brief is
     * written once, a room is rearranged any number of times.
     */
    /**
     * Presence is a heartbeat, not a session. A browser that closes without
     * saying goodbye must not haunt a piece forever, so `here` is re-POSTed
     * every ~20s and anything unheard-from for 60s is swept.
     */
    const here = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})\/(here|gone)$/.exec(path);
    if (method === "POST" && here) {
      if (deny) return closed();
      const body = (await readJson(req)) as Record<string, unknown>;
      const fan = str(body.fan_id);
      if (!fan) return json(res, 400, { error: "fan_id is required" });
      /**
       * No publish here. `join`/`leave` already broadcast, and only when the
       * room actually CHANGED -- publishing from this handler instead fanned
       * every 20-second heartbeat out to every subscriber as a fresh presence
       * event, which is the same room state repeated forever.
       */
      const p =
        here[2] === "here"
          ? this.live.join(here[1]!, fan, str(body.display_name, 120) ?? undefined)
          : this.live.leave(here[1]!, fan);
      return json(res, 200, p);
    }

    const place = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})\/place$/.exec(path);
    if (method === "POST" && place) {
      if (deny) return closed();
      const body = (await readJson(req)) as Record<string, unknown>;
      const loc = str(body.location, 64);
      if (!loc) return json(res, 400, { error: "location is required" });
      if (!placePiece(this.repo, place[1]!, loc)) {
        return json(res, 404, { error: `no piece '${place[1]!}'` });
      }
      return json(res, 200, { piece: getPiece(this.repo, place[1]!) });
    }

    if (method === "POST" && path === "/v1/pieces") {
      if (deny) return closed();
      return this.postSeed(res, await readJson(req));
    }
    if (method === "POST" && path === "/v1/seen") {
      if (deny) return closed();
      const body = (await readJson(req)) as Record<string, unknown>;
      const fan = str(body.fan_id);
      if (!fan) return json(res, 400, { error: "fan_id is required" });
      markSeen(this.repo, fan);
      return json(res, 200, { status: "seen" });
    }

    const extend = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})\/extend$/.exec(path);
    if (method === "POST" && extend) {
      if (deny) return closed();
      return await this.postExtend(res, extend[1]!, await readJson(req), bearer(req));
    }

    const one = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})$/.exec(path);
    if (method === "GET" && one) {
      if (deny) return closed();
      const full = this.lineage(one[1]!);
      if (!full) return json(res, 404, { error: `no piece '${one[1]!}'` });
      return json(res, 200, full);
    }

    if (method === "GET" && this.webRoot && this.serveStatic(path, res)) return;

    json(res, 404, { error: `no route for ${method} ${path}` });
  }

  /**
   * SOMEBODY BUILDS ON SOMEBODY. The one write, and the whole product.
   *
   * `notifies` is passed straight through from the repo. Recomputing it here --
   * "look up the parent, read its author" -- would be a second implementation
   * of the only question this product has to get right, free to drift from the
   * first and point the feeling at the wrong person.
   */
  private async postExtend(
    res: ServerResponse,
    pieceId: string,
    raw: unknown,
    token: string | undefined,
  ): Promise<void> {
    const b = raw as Record<string, unknown>;
    const fan = str(b.fan_id);
    const parent = str(b.parent_event_id);
    if (!fan || !parent) {
      return json(res, 400, { error: "fan_id and parent_event_id are required" });
    }

    /**
     * Length is judged on the trimmed body and the trimmed body is what gets
     * stored. Twelve spaces is not eight characters of work, and trailing
     * newlines from a textarea are not somebody's contribution.
     */
    const body = typeof b.body === "string" ? b.body.trim() : "";
    if (body.length < BODY_MIN) {
      return json(res, 400, {
        error: `body must be at least ${BODY_MIN} characters -- say something`,
      });
    }
    if (body.length > BODY_MAX) {
      return json(res, 400, {
        error: `body must be at most ${BODY_MAX} characters (got ${body.length})`,
      });
    }

    /**
     * A VERIFIED ID BELONGS TO ONE PERSON.
     *
     * Without this check verification would be decoration: a stranger could
     * still post as "ada" by asserting the id in the body, and Ada's permanent,
     * public, un-editable attribution would carry somebody else's words. The
     * one thing this product sells is that a name on a piece of work is true.
     *
     * Unclaimed ids stay open to anybody, because forcing a login to leave one
     * line of writing is how a space stays empty.
     */
    const who = identify(this.repo, token, fan);
    if (!who || !mayActAs(this.repo, who, fan)) {
      return json(res, 403, {
        error: `"${fan}" has been claimed. Sign in as them, or use another name.`,
        code: "claimed",
      });
    }

    /**
     * Before anything is written or any invocation is spent. One person cannot
     * flood a piece, and a refusal costs nothing -- checking after the host
     * call would have paid a Mind to narrate work we were about to reject.
     */
    const rate = extendRate(this.repo, fan);
    if (!rate.ok) {
      return json(res, 429, {
        error: "too many contributions in a short window -- give it a moment",
        retry_after: rate.retry_after,
      });
    }

    try {
      /**
       * THE SENTENCE IS WRITTEN BEFORE THE WRITE, because there is no editing
       * it in afterwards -- the log refuses UPDATE by design.
       *
       * And only when somebody is actually waiting. Extending the creator's
       * seed has no recipient, and narrating it anyway produced, on a live run,
       * "Ada kept your five ordinary things" -- addressed to the brief as
       * though the brief were a person. No recipient, nothing to say.
       */
      const piece = getPiece(this.repo, pieceId);
      const addressee = parentAuthor(this.repo, parent);
      const changed =
        piece && addressee && addressee.fan_id !== fan
          ? await narrateChange(this.host, {
              piece_title: piece.title,
              parent_body: addressee.body,
              parent_author: addressee.display_name,
              child_body: body,
              child_author: str(b.display_name, 120) ?? fan,
            })
          : undefined;

      const r = extendPiece(this.repo, {
        piece_id: pieceId,
        parent_event_id: parent,
        fan_id: fan,
        body,
        changed,
        display_name: str(b.display_name, 120) ?? undefined,
      });
      /**
       * Queue the ping, do not send it. Sending on the request path would put a
       * mail server between somebody hitting submit and seeing their own work
       * appear -- and the whole latency argument in this project is that no
       * human waits on anything slow. One row, no network.
       *
       * Only when somebody is actually waiting. `notifies` is null for an
       * extension of the creator's seed, and there is nobody to tell.
       */
      if (r.notifies) {
        enqueue(this.repo, {
          fan_id: r.notifies,
          kind: "extended",
          piece_id: r.piece.piece_id,
          event_id: r.extension.event_id,
        });
      }

      this.live.publish({
        type: "piece_extended",
        piece_id: r.piece.piece_id,
        event_id: r.extension.event_id,
        fan_id: r.extension.fan_id,
        display_name: r.extension.display_name,
        generation: r.piece.generation,
        ...(r.extension.changed ? { changed: r.extension.changed } : {}),
      });

      const out: ExtendResponse = {
        event_id: r.extension.event_id,
        piece_id: r.piece.piece_id,
        generation: r.piece.generation,
        ...(r.extension.changed ? { changed: r.extension.changed } : {}),
        permalink: this.permalink(r.extension.event_id),
        notifies: r.notifies,
      };
      json(res, 201, out);
    } catch (e) {
      if (e instanceof ExtendError) {
        return json(res, STATUS[e.code], { error: e.message, code: e.code });
      }
      throw e;
    }
  }

  /**
   * THE RETURN SCREEN. An empty list is a real answer and goes back as one --
   * see `waitingFor`. Nothing here fills a quiet day with something invented.
   */
  private getWaiting(res: ServerResponse, url: URL): void {
    const fan = str(url.searchParams.get("fan"));
    if (!fan) return json(res, 400, { error: "fan is required" });
    json(res, 200, waitingFor(this.repo, fan, (id) => this.permalink(id)));
  }

  // -------------------------------------------------------------------------
  // THE PUBLIC PAGE
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
.brief{margin:0 0 2.5rem}
li{list-style:none;padding:1.1rem 0;border-top:1px solid var(--line)}
ul{padding:0;margin:0}
li p{margin:.35rem 0 .5rem;white-space:pre-wrap}
time{color:var(--dim);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;display:block}
a{color:inherit}
.who{font-weight:600}
.id{color:var(--dim);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
.changed{color:var(--dim);font-style:italic}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line);
 color:var(--dim);font-size:13px}
</style>
<main>${body}</main>`;
  }

  /**
   * The piece and everyone who changed it, oldest first.
   *
   * Oldest first because this is not a feed -- it is a thing being built, and
   * the fifth extension only makes sense after the fourth. Newest-first would
   * be reading the argument backwards.
   *
   * Every entry links to its receipt, which is the difference between saying
   * somebody made this and being able to check.
   */
  /**
   * A creator starts something. The only way in over HTTP -- without it a piece
   * could only be created in-process, which meant the product had no first
   * step for the one person who has to take it.
   */
  private postSeed(res: ServerResponse, raw: unknown): void {
    const b = raw as Record<string, unknown>;
    const title = str(b.title, 200);
    const brief = typeof b.brief === "string" ? b.brief.trim() : "";
    if (!title) return json(res, 400, { error: "title is required" });
    /**
     * The brief is not optional and not decoration. It is the single strongest
     * lever on whether anybody contributes anything worth building on: a vague
     * one produces "nice!", a sharp one produces work. Refusing an empty one is
     * cheaper than a space full of pieces nobody can answer.
     */
    if (brief.length < 12) {
      return json(res, 400, { error: "brief must say what a good addition looks like" });
    }
    const piece = seedPiece(this.repo, { title, brief, location: str(b.location, 64) ?? "" });
    this.live.publish({ type: "piece_seeded", piece_id: piece.piece_id, title: piece.title });
    json(res, 201, { piece, page: `${this.publicUrl}/w/${this.worldSlug()}/p/${piece.piece_id}` });
  }

  /** One extension, permanently addressable. What a citation points at. */
  private pageReceipt(res: ServerResponse, eventId: string): void {
    const e = this.repo.getEvent(eventId);
    if (!e || (e.type !== "piece_extended" && e.type !== "piece_seeded")) {
      return html(res, 404, this.page("Not in the log",
        `<h1>Not in the log</h1><p class="sub">${esc(eventId)}</p>
<p>Nothing here is generated on demand. If it is not in the append-only log, it did not happen.</p>`));
    }
    /**
     * The one that matters most: this is the link people share. A takedown
     * that left the permalink serving is not a takedown at all.
     */
    if (isHidden(this.repo, eventId)) {
      return html(res, 404, this.page("Taken down",
        `<h1>Taken down</h1><p>This contribution was removed by the space's owner.</p>
<footer>The record of it still exists in the log -- hiding is additive, and nothing is erased.</footer>`));
    }

    const p = e.payload as Record<string, unknown>;
    const pieceId = String(p.piece_id ?? "");
    const piece = getPiece(this.repo, pieceId);
    const who = String(p.fan_id ?? "");
    const name = who ? this.repo.getVisitor(who)?.display_name || who : "the brief";
    const body = String(p.body ?? p.brief ?? "");
    html(res, 200, this.page(
      `${name} on ${piece?.title ?? pieceId}`,
      `<h1>${esc(name)}</h1>
<p class="sub"><time>${esc(e.ts)}</time>on <a href="/w/${esc(this.worldSlug())}/p/${esc(pieceId)}">${esc(piece?.title ?? pieceId)}</a></p>
<p>${esc(body)}</p>
${typeof p.changed === "string" && p.changed ? `<p class="sub">${esc(p.changed)}</p>` : ""}
<p class="id">${esc(e.event_id)}</p>
<footer>This record cannot be edited or deleted -- the database refuses both.</footer>`));
  }

  /**
   * The app itself. Path traversal is blocked the same way the ward's static
   * server blocks it: resolve, then require the result to still be inside root.
   */
  private serveStatic(path: string, res: ServerResponse): boolean {
    if (!this.webRoot) return false;
    /**
     * `/shared/` is web-voxel/scene, the same directory webSurface serves under
     * the same prefix. The portal bake lives there so the browser hero and the
     * piece standing in the voxel world are one artwork rather than two copies
     * that drift -- the precedent set by the look profiles, the sky dome and
     * the grade shader, which are shared for exactly the same reason.
     */
    const shared = path.startsWith("/shared/");
    const root = shared ? here("../../web-voxel/scene") : this.webRoot;
    const rel = shared
      ? path.slice("/shared".length)
      : path === "/"
        ? "/index.html"
        : path;
    const full = resolve(join(root, decodeURIComponent(rel)));
    const base = resolve(root);
    if (full !== base && !full.startsWith(base + sep)) return false;
    if (!existsSync(full) || !statSync(full).isFile()) return false;
    const type =
      { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json",
        ".svg": "image/svg+xml", ".png": "image/png" }[extname(full)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    createReadStream(full).pipe(res);
    return true;
  }

  private pagePiece(res: ServerResponse, pieceId: string): void {
    const full = this.lineage(pieceId);
    if (!full) {
      return html(
        res,
        404,
        this.page(
          "No such piece",
          `<h1>No such piece</h1><p class="sub">${esc(pieceId)}</p>
<p>Nothing here is generated on demand — if it is not in the log, it did not happen.</p>`,
        ),
      );
    }

    const { piece, extensions, seed_event_id } = full;
    // The room segment of the incoming URL is cosmetic. Links are built from
    // the world's own slug so they match the receipts MemoryApi serves.
    const room = esc(this.worldSlug());
    const receipt = (eventId: string): string => `/w/${room}/e/${esc(eventId)}`;

    const rows = extensions
      .map((x) => {
        const who = this.repo.getVisitor(x.fan_id)?.display_name || x.fan_id;
        return `<li><time>${esc(x.ts)}</time>
<p class="who">${esc(who)}</p>
${x.changed ? `<p class="changed">${esc(x.changed)}</p>` : ""}
<p>${esc(x.body)}</p>
<p class="id"><a href="${receipt(x.event_id)}">${esc(x.event_id)}</a></p></li>`;
      })
      .join("\n");

    html(
      res,
      200,
      this.page(
        piece.title,
        `<h1>${esc(piece.title)}</h1>
<p class="sub">${extensions.length === 1 ? "1 extension" : `${extensions.length} extensions`} &middot; ${esc(piece.status)}
&middot; <a href="${receipt(seed_event_id)}">seeded</a></p>
<p class="brief">${esc(piece.brief)}</p>
${
  extensions.length
    ? `<ul>${rows}</ul>`
    : `<p class="sub">Nobody has extended this yet.</p>`
}
<footer>Every name above is an append-only record — the database refuses to edit
or delete one, so nobody's name can be taken off their work.</footer>`,
      ),
    );
  }
}
