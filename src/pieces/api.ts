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
import type { CanonRepo } from "../canon/repo.js";
import { log } from "../log.js";
import { BODY_MAX, BODY_MIN, type ExtendResponse } from "./contract.js";
import { ExtendError, extendPiece, lineage, listPieces, waitingFor } from "./repo.js";

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
  private readonly publicUrl: string;

  constructor(opts: PiecesApiOptions) {
    this.repo = opts.repo;
    this.port = opts.port ?? 8792;
    this.apiKey = opts.apiKey;
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
    if (this.http) await new Promise<void>((r) => this.http!.close(() => r()));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    // ---- public: the shareable artefact ------------------------------------
    const page = /^\/w\/[^/]+\/p\/([A-Za-z0-9_]{1,64})$/.exec(path);
    if (method === "GET" && page) return this.pagePiece(res, page[1]!);

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

    const extend = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})\/extend$/.exec(path);
    if (method === "POST" && extend) {
      if (deny) return closed();
      return this.postExtend(res, extend[1]!, await readJson(req));
    }

    const one = /^\/v1\/pieces\/([A-Za-z0-9_]{1,64})$/.exec(path);
    if (method === "GET" && one) {
      if (deny) return closed();
      const full = lineage(this.repo, one[1]!);
      if (!full) return json(res, 404, { error: `no piece '${one[1]!}'` });
      return json(res, 200, full);
    }

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
  private postExtend(res: ServerResponse, pieceId: string, raw: unknown): void {
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

    try {
      /**
       * No `changed` sentence. The Mind writes it (see NarrateRequest) and this
       * server has no host wired to it; the contract says the extension stands
       * without the narration, so it stands. Losing the sentence must never
       * lose the work.
       */
      const r = extendPiece(this.repo, {
        piece_id: pieceId,
        parent_event_id: parent,
        fan_id: fan,
        body,
        display_name: str(b.display_name, 120) ?? undefined,
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
  private pagePiece(res: ServerResponse, pieceId: string): void {
    const full = lineage(this.repo, pieceId);
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
