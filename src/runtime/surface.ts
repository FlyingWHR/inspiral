import type { RenderedBehavior } from "./character.js";
import type { WorldEvent } from "../types/events.js";

/**
 * ENGINE-FACING SURFACE.
 *
 * The 3D engine is an open question, so this file contains no engine code and
 * imports nothing. It is the shape a Luanti mod, a Godot autoload or a Telegram
 * bot would implement later, and it is deliberately dumb: behavior in, side
 * effect out.
 *
 * Nothing above this boundary knows what a mesh is. Nothing below it is allowed
 * to write canon.
 */

export interface SurfaceAdapter {
  readonly name: string;

  /** An NPC performs. Speak the lines, play the animation, move the body. */
  present(behavior: RenderedBehavior): Promise<void> | void;

  /** Something went on the district notice board. */
  postNotice?(text: string, author: string): Promise<void> | void;

  /** A world event landed. Optional -- for ambient reactions and logging. */
  onEvent?(event: WorldEvent): Promise<void> | void;

  /** Called once at startup and once at shutdown. */
  open?(): Promise<void> | void;
  close?(): Promise<void> | void;
}

/** Writes to stdout. What the demo uses. */
export class ConsoleSurface implements SurfaceAdapter {
  readonly name = "console";
  private nameOf: (id: string) => string;

  constructor(nameOf: (id: string) => string = (id) => id) {
    this.nameOf = nameOf;
  }

  present(b: RenderedBehavior): void {
    const who = this.nameOf(b.character_id);
    const where = b.action.target ? ` -> ${this.nameOf(b.action.target)}` : "";
    console.log(`    ${who} [${b.action.verb}${where}]`);
    for (const line of b.lines) console.log(`      "${line}"`);
    if (b.post_draft) console.log(`      BOARD: ${b.post_draft}`);
    if (b.cites.length) console.log(`      (cites ${b.cites.join(", ")})`);
  }

  postNotice(text: string, author: string): void {
    console.log(`    BOARD [${author}]: ${text}`);
  }
}

/** Collects instead of printing. Used by the tests. */
export class MemorySurface implements SurfaceAdapter {
  readonly name = "memory";
  readonly presented: RenderedBehavior[] = [];
  readonly notices: { text: string; author: string }[] = [];
  readonly events: WorldEvent[] = [];

  present(b: RenderedBehavior): void {
    this.presented.push(b);
  }
  postNotice(text: string, author: string): void {
    this.notices.push({ text, author });
  }
  onEvent(e: WorldEvent): void {
    this.events.push(e);
  }
}

/** Discards everything. For headless ticking. */
export class NullSurface implements SurfaceAdapter {
  readonly name = "null";
  present(): void {
    /* noop */
  }
}
