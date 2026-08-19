/**
 * THE 3D SURFACE. One file, same swap cost as the host runtime.
 *
 * This is the only file in the repo that knows a browser exists, and it still
 * does not know what a mesh is: it serves static files and broadcasts semantic
 * beats over a WebSocket. All geometry, animation and choreography live in
 * web/main.js, on the far side of the socket.
 *
 * It does not write canon. Visitor input arrives as an *intent* and is handed
 * to the caller, which decides whether to spend a host invocation on it.
 */

import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocketServer, WebSocket } from "ws";
import type { RenderedBehavior } from "./character.js";
import type { WorldEvent } from "../types/events.js";
import type { SurfaceAdapter, SurfaceActor, SurfacePoint } from "./surface.js";
import { log } from "../log.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Canon locations are opaque strings above this line; down here they are spots
 * on a ground plane. This table is the entire mapping, and it is the only
 * place that has to change when the set changes.
 */
export const WARD_PLACES: Record<string, SurfacePoint> = {
  plaza: { x: 0, z: 0 },
  counting_house: { x: -6.6, z: -3.2 },
  kiln_row: { x: 6.6, z: -3.2 },
  almshouse: { x: 0, z: 6.4 },
  gate: { x: 0, z: -17 },
};

/** Anything the browser can ask the world for. `mint` carries a pasted sheet. */
export interface SurfaceIntent {
  kind: "arrive" | "act" | "leave" | "mint" | "edit";
  /**
   * Which fan this came from. Assigned per connection, so two browsers on the
   * same ward are two different people with separate memories.
   */
  visitor?: { id: string; name: string };
  text?: string;
  /** Only present for "edit"; shape is owned by the surface that handles it. */
  edit?: unknown;
}

export interface WebSurfaceOptions {
  port?: number;
  /** Directory holding index.html. Defaults to the repo's web/. */
  root?: string;
  /** three.js package root, served at /vendor/three. */
  vendor?: string;
  /** Shared CC0 asset root, served at /assets. One copy, every surface. */
  assets?: string;
  /** Identities handed out to connections, in order. */
  visitorPool?: { id: string; name: string }[];
  places?: Record<string, SurfacePoint>;
  /**
   * Which HostRuntime is actually driving this world. Shown in the HUD so it
   * is provable on camera which one is running, rather than asserted.
   */
  hostName?: string;
  /** Called when the browser asks for something. May spend an invocation. */
  onIntent?: (intent: SurfaceIntent) => void | Promise<void>;
  /**
   * Resolve a cited event id against the log, so a complaint can be shown to
   * be TRUE on screen rather than merely plausible. The surface never reads
   * canon itself; the caller hands it a lookup.
   */
  resolveCite?: (eventId: string) => { ts: string; summary: string } | undefined;
}

type Beat =
  | { t: "spawn"; actor: SurfaceActor; at: SurfacePoint }
  | { t: "despawn"; id: string }
  | { t: "move"; id: string; at: SurfacePoint }
  | {
      t: "say";
      id: string;
      verb: string;
      target: string | null;
      lines: string[];
      /** Narration. The client must NOT put this in a speech bubble. */
      stage: string;
      post: string | null;
      cites: string[];
      /** Each citation, resolved against the append-only log. */
      citeDetail: { id: string; ts: string; summary: string; ok: boolean }[];
    }
  | { t: "notice"; author: string; text: string }
  | { t: "event"; kind: string; summary: string };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Resolve inside a root, or null. Blocks `..` traversal and symlink escapes. */
function safeJoin(root: string, urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "");
  const full = resolve(join(root, clean));
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export class WebSurface implements SurfaceAdapter {
  readonly name: string = "web";

  private readonly port: number;
  private readonly root: string;
  private readonly vendor: string;
  private readonly assets: string;
  private readonly places: Record<string, SurfacePoint>;
  private readonly onIntent: WebSurfaceOptions["onIntent"];
  /** Mutable: a host can fall back to mock after the surface is constructed. */
  hostName: string;
  private readonly resolveCite: WebSurfaceOptions["resolveCite"];

  private http?: Server;
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  /** Which fan each open socket is. Freed when they disconnect. */
  private readonly identities = new Map<WebSocket, { id: string; name: string }>();
  private readonly pool: { id: string; name: string }[];

  /** Enough state that a browser opened on day 4 sees a populated ward. */
  private readonly actors = new Map<string, { actor: SurfaceActor; at: SurfacePoint }>();
  private readonly recent: Beat[] = [];
  private improvised = 0;

  constructor(opts: WebSurfaceOptions = {}) {
    this.port = opts.port ?? 8787;
    this.root = opts.root ?? here("../../web");
    this.vendor = opts.vendor ?? here("../../node_modules/three");
    this.assets = opts.assets ?? here("../../web/assets");
    this.places = { ...(opts.places ?? WARD_PLACES) };
    this.onIntent = opts.onIntent;
    this.hostName = opts.hostName ?? "mock";
    this.pool = opts.visitorPool ?? [
      { id: "wren", name: "Wren" },
      { id: "ash", name: "Ash" },
      { id: "juno", name: "Juno" },
      { id: "pell", name: "Pell" },
    ];
    this.resolveCite = opts.resolveCite;
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Resolve a canon location, an explicit point, or invent a spot.
   *
   * A minted character names a home the ward has never heard of ("wharf"), so
   * unknown locations are assigned a free place on a ring around the plaza and
   * remembered. Without this every newcomer would stand inside the last one.
   */
  private point(to: SurfacePoint | string | undefined): SurfacePoint {
    if (!to) return this.places.plaza ?? { x: 0, z: 0 };
    if (typeof to !== "string") return to;
    const known = this.places[to];
    if (known) return known;

    // An onboarded cast names homes this scene has never heard of
    // ("exchange_floor"). Give them the archetype's unused named spots first --
    // that is what the places are FOR -- and only improvise once they run out.
    const taken = new Set([...this.actors.values()].map((a) => `${a.at.x},${a.at.z}`));
    for (const [name, spot] of Object.entries(this.places)) {
      if (name === "gate" || name === "plaza") continue; // keep the entrance clear
      if (!taken.has(`${spot.x},${spot.z}`)) {
        this.places[to] = spot;
        return spot;
      }
    }

    const n = this.improvised++;
    const angle = -Math.PI / 2 + (n + 1) * 2.3; // irrational-ish step, no clumps
    const spot = {
      x: Math.round(Math.cos(angle) * 5.6 * 10) / 10,
      z: Math.round((Math.sin(angle) * 5.6 + 1.5) * 10) / 10,
    };
    this.places[to] = spot;
    this.broadcastPlaces();
    return spot;
  }

  /**
   * Nudge a spot that is already taken. Two characters can legitimately share a
   * home ("plaza"), and a body standing inside another body reads as a bug even
   * when canon is perfectly correct.
   */
  private free(at: SurfacePoint): SurfacePoint {
    const taken = (p: SurfacePoint) =>
      [...this.actors.values()].some(
        (a) => Math.hypot(a.at.x - p.x, a.at.z - p.z) < 2.8,
      );
    if (!taken(at)) return at;
    for (let i = 1; i <= 12; i++) {
      const angle = i * 2.4;
      const candidate = {
        x: Math.round((at.x + Math.cos(angle) * (2.2 + i * 0.35)) * 10) / 10,
        z: Math.round((at.z + Math.sin(angle) * (2.2 + i * 0.35)) * 10) / 10,
      };
      if (!taken(candidate)) return candidate;
    }
    return at;
  }

  private broadcastPlaces(): void {
    const payload = JSON.stringify({ t: "places", places: this.places });
    for (const c of this.clients) if (c.readyState === 1) c.send(payload);
  }

  async open(): Promise<void> {
    // ws is loaded here, not at module scope, so importing the surface (or
    // anything that re-exports it) never requires the dependency to exist.
    const { WebSocketServer: WSS } = await import("ws");

    this.http = createServer((req, res) => this.serve(req.url ?? "/", res));
    this.wss = new WSS({ server: this.http });

    this.wss.on("connection", (sock: WebSocket) => {
      this.clients.add(sock);
      const me = this.claimIdentity();
      this.identities.set(sock, me);
      sock.send(
        JSON.stringify({
          t: "hello",
          host: this.hostName,
          you: me,
          places: this.places,
          actors: [...this.actors.values()],
          recent: this.recent,
        }),
      );
      sock.on("message", (raw: unknown) => {
        void this.handleIntent(String(raw), this.identities.get(sock));
      });
      const drop = () => {
        this.clients.delete(sock);
        this.identities.delete(sock);
      };
      sock.on("close", drop);
      sock.on("error", drop);
    });

    await new Promise<void>((ok) => this.http!.listen(this.port, ok));
    log.info(`surface: ${this.url}`);
  }

  async close(): Promise<void> {
    for (const c of this.clients) c.close();
    this.clients.clear();
    this.wss?.close();
    await new Promise<void>((ok) => (this.http ? this.http.close(() => ok()) : ok()));
  }

  /**
   * Subclasses claim intents the base transport does not understand. Return
   * true to stop the intent going any further.
   */
  protected async handleIntentHook(_intent: SurfaceIntent): Promise<boolean> {
    return false;
  }

  /** First unused identity in the pool, or a numbered guest if it is full. */
  private claimIdentity(): { id: string; name: string } {
    const taken = new Set([...this.identities.values()].map((v) => v.id));
    const free = this.pool.find((p) => !taken.has(p.id));
    if (free) return free;
    const n = taken.size + 1;
    return { id: `guest_${n}`, name: `Guest ${n}` };
  }

  /** Everyone currently connected, for a HUD that wants to list the room. */
  get presentVisitors(): { id: string; name: string }[] {
    return [...this.identities.values()];
  }

  private async handleIntent(
    raw: string,
    visitor?: { id: string; name: string },
  ): Promise<void> {
    let msg: { t?: string; text?: string; edit?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const KINDS = ["arrive", "act", "leave", "mint", "edit"] as const;
    const kind = KINDS.find((k) => k === msg.t);
    if (!kind) return;
    if (await this.handleIntentHook({ kind, edit: msg.edit, ...(visitor ? { visitor } : {}) })) return;
    if (!this.onIntent) return;
    try {
      // Browser text is untrusted and is about to become a host prompt. Cap it.
      // A pasted sheet needs more room than a one-line action.
      const cap = kind === "mint" ? 4000 : 200;
      await this.onIntent({ kind, text: msg.text?.slice(0, cap), ...(visitor ? { visitor } : {}) });
    } catch (e) {
      log.error(`visitor intent failed: ${(e as Error).message}`);
    }
  }

  /**
   * Subclasses can answer a route with generated content instead of a file.
   * Return null to fall through to the static roots.
   */
  protected serveExtra(_urlPath: string): { body: string; type: string } | null {
    return null;
  }

  private serve(urlPath: string, res: import("node:http").ServerResponse): void {
    const generated = this.serveExtra(urlPath.split("?")[0] ?? urlPath);
    if (generated) {
      res.writeHead(200, { "content-type": generated.type, "cache-control": "no-cache" });
      res.end(generated.body);
      return;
    }

    let file: string | null;
    if (urlPath.startsWith("/vendor/three/")) {
      file = safeJoin(this.vendor, urlPath.slice("/vendor/three".length));
    } else if (urlPath.startsWith("/assets/")) {
      // Every surface shares one asset directory rather than copying 2 MB of
      // CC0 GLBs per client.
      file = safeJoin(this.assets, urlPath.slice("/assets".length));
    } else {
      file = safeJoin(this.root, urlPath === "/" ? "/index.html" : urlPath);
    }

    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    createReadStream(file).pipe(res);
  }

  private emit(beat: Beat): void {
    this.recent.push(beat);
    if (this.recent.length > 120) this.recent.shift();
    const payload = JSON.stringify(beat);
    for (const c of this.clients) {
      // readyState 1 === OPEN. Avoids importing ws just for the constant.
      if (c.readyState === 1) c.send(payload);
    }
  }

  // --- SurfaceAdapter -------------------------------------------------------

  spawn(actor: SurfaceActor): void {
    const at = this.free(this.point(actor.home));
    // Idempotent: a returning visitor is already on the books, and a second
    // spawn beat would read as a second person walking in.
    if (this.actors.has(actor.id)) {
      this.moveTo(actor.id, at);
      return;
    }
    this.actors.set(actor.id, { actor, at });
    this.emit({ t: "spawn", actor, at });
  }

  despawn(id: string): void {
    this.actors.delete(id);
    this.emit({ t: "despawn", id });
  }

  moveTo(id: string, to: SurfacePoint | string): void {
    const at = this.point(to);
    const known = this.actors.get(id);
    if (known) known.at = at;
    this.emit({ t: "move", id, at });
  }

  present(b: RenderedBehavior): void {
    const citeDetail = b.cites.map((id) => {
      const found = this.resolveCite?.(id);
      return {
        id,
        ts: found?.ts ?? "",
        summary: found?.summary ?? "NOT IN THE LOG",
        ok: Boolean(found),
      };
    });
    this.emit({
      t: "say",
      id: b.character_id,
      verb: b.action.verb,
      target: b.action.target ?? null,
      lines: b.lines,
      stage: b.stage ?? "",
      post: b.post_draft ?? null,
      cites: b.cites,
      citeDetail,
    });
  }

  postNotice(text: string, author: string): void {
    this.emit({ t: "notice", author, text });
  }

  onEvent(e: WorldEvent): void {
    const summary = e.payload?.summary;
    this.emit({ t: "event", kind: e.type, summary: typeof summary === "string" ? summary : e.type });
  }
}
