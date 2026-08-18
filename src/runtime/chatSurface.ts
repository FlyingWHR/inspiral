/**
 * THE SAME WARD, AS TEXT.
 *
 * This exists to prove one claim: the world is a display surface and the
 * simulation is not. ChatSurface implements exactly the same SurfaceAdapter as
 * the three.js surface, renders to a terminal (or a chat transport) instead of
 * a GPU, and shows the same cast acting on the same canon.
 *
 * There is no 3D vocabulary in here at all -- moveTo is a sentence, not a
 * translation. That is the test: if a surface can render the world without
 * knowing what a coordinate is, the coupling is genuinely at the seam.
 */

import type { RenderedBehavior } from "./character.js";
import type { WorldEvent } from "../types/events.js";
import type { SurfaceAdapter, SurfaceActor, SurfacePoint } from "./surface.js";

export interface ChatSurfaceOptions {
  /** Where a line goes. Defaults to stdout; a bot would pass its send(). */
  write?: (line: string) => void;
  /** ANSI colour. Off when piping to a file or a chat API. */
  color?: boolean;
}

const ANSI = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

export class ChatSurface implements SurfaceAdapter {
  readonly name = "chat";

  private readonly write: (line: string) => void;
  private readonly c: typeof ANSI;
  private readonly names = new Map<string, string>();

  constructor(opts: ChatSurfaceOptions = {}) {
    this.write = opts.write ?? ((l) => console.log(l));
    const on = opts.color ?? Boolean(process.stdout?.isTTY);
    this.c = on
      ? ANSI
      : { dim: "", bold: "", cyan: "", green: "", yellow: "", reset: "" };
  }

  private who(id: string): string {
    return this.names.get(id) ?? this.names.get(id.replace(/^fan:/, "")) ?? id;
  }

  spawn(a: SurfaceActor): void {
    this.names.set(a.id, a.name);
    const what = a.kind === "visitor" ? "walks into the ward" : "is here";
    this.write(
      `${this.c.dim}--${this.c.reset} ${this.c.bold}${a.name}${this.c.reset}` +
        `${a.title ? `, ${a.title},` : ""} ${what}.`,
    );
  }

  despawn(id: string): void {
    this.write(`${this.c.dim}-- ${this.who(id)} leaves.${this.c.reset}`);
  }

  /** A 3D surface walks a body. Here it is simply narrated. */
  moveTo(id: string, to: SurfacePoint | string): void {
    const where = typeof to === "string" ? to.replace(/_/g, " ") : "the plaza";
    this.write(`${this.c.dim}-- ${this.who(id)} moves to ${where}.${this.c.reset}`);
  }

  present(b: RenderedBehavior): void {
    const target = b.action.target ? ` ${this.c.dim}→${this.c.reset} ${this.who(b.action.target)}` : "";
    this.write(
      `\n${this.c.cyan}${this.c.bold}${this.who(b.character_id)}${this.c.reset}` +
        ` ${this.c.dim}[${b.action.verb.replace(/_/g, " ")}]${this.c.reset}${target}`,
    );
    for (const line of b.lines) this.write(`   "${line}"`);
    if (b.post_draft) this.write(`   ${this.c.yellow}BOARD:${this.c.reset} ${b.post_draft}`);
    if (b.cites.length) {
      this.write(`   ${this.c.green}cites ${b.cites.join(", ")}${this.c.reset}`);
    }
  }

  postNotice(text: string, author: string): void {
    this.write(`${this.c.yellow}BOARD${this.c.reset} ${this.c.dim}[${this.who(author)}]${this.c.reset} ${text}`);
  }

  onEvent(e: WorldEvent): void {
    const summary = e.payload?.summary;
    this.write(`${this.c.dim}   · ${typeof summary === "string" ? summary : e.type}${this.c.reset}`);
  }

  /** Let a transport pre-load display names it already knows. */
  learnNames(pairs: Iterable<[string, string]>): void {
    for (const [id, name] of pairs) this.names.set(id, name);
  }
}
