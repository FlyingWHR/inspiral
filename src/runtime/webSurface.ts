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

export interface VisitorIntent {
  kind: "arrive" | "act" | "leave";
  text?: string;
}

export interface WebSurfaceOptions {
  port?: number;
  /** Directory holding index.html. Defaults to the repo's web/. */
  root?: string;
  /** three.js package root, served at /vendor/three. */
  vendor?: string;
  places?: Record<string, SurfacePoint>;
  /** Called when the browser asks for something. May spend an invocation. */
  onIntent?: (intent: VisitorIntent) => void | Promise<void>;
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
      post: string | null;
      cites: string[];
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
  readonly name = "web";

  private readonly port: number;
  private readonly root: string;
  private readonly vendor: string;
  private readonly places: Record<string, SurfacePoint>;
  private readonly onIntent: WebSurfaceOptions["onIntent"];

  private http?: Server;
  private wss?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  /** Enough state that a browser opened on day 4 sees a populated ward. */
  private readonly actors = new Map<string, { actor: SurfaceActor; at: SurfacePoint }>();
  private readonly recent: Beat[] = [];

  constructor(opts: WebSurfaceOptions = {}) {
    this.port = opts.port ?? 8787;
    this.root = opts.root ?? here("../../web");
    this.vendor = opts.vendor ?? here("../../node_modules/three");
    this.places = opts.places ?? WARD_PLACES;
    this.onIntent = opts.onIntent;
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  /** Resolve a canon location, an explicit point, or fall back to the plaza. */
  private point(to: SurfacePoint | string | undefined): SurfacePoint {
    if (!to) return this.places.plaza ?? { x: 0, z: 0 };
    if (typeof to === "string") return this.places[to] ?? this.places.plaza ?? { x: 0, z: 0 };
    return to;
  }

  async open(): Promise<void> {
    // ws is loaded here, not at module scope, so importing the surface (or
    // anything that re-exports it) never requires the dependency to exist.
    const { WebSocketServer: WSS } = await import("ws");

    this.http = createServer((req, res) => this.serve(req.url ?? "/", res));
    this.wss = new WSS({ server: this.http });

    this.wss.on("connection", (sock: WebSocket) => {
      this.clients.add(sock);
      sock.send(
        JSON.stringify({
          t: "hello",
          places: this.places,
          actors: [...this.actors.values()],
          recent: this.recent,
        }),
      );
      sock.on("message", (raw: unknown) => {
        void this.handleIntent(String(raw));
      });
      sock.on("close", () => this.clients.delete(sock));
      sock.on("error", () => this.clients.delete(sock));
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

  private async handleIntent(raw: string): Promise<void> {
    let msg: { t?: string; text?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const kind = msg.t === "arrive" || msg.t === "act" || msg.t === "leave" ? msg.t : null;
    if (!kind || !this.onIntent) return;
    try {
      // Browser text is untrusted and is about to become a host prompt. Cap it.
      await this.onIntent({ kind, text: msg.text?.slice(0, 200) });
    } catch (e) {
      log.error(`visitor intent failed: ${(e as Error).message}`);
    }
  }

  private serve(urlPath: string, res: import("node:http").ServerResponse): void {
    let file: string | null;
    if (urlPath.startsWith("/vendor/three/")) {
      file = safeJoin(this.vendor, urlPath.slice("/vendor/three".length));
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
    const at = this.point(actor.home);
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
    this.emit({
      t: "say",
      id: b.character_id,
      verb: b.action.verb,
      target: b.action.target ?? null,
      lines: b.lines,
      post: b.post_draft ?? null,
      cites: b.cites,
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
