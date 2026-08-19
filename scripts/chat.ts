/**
 * THE WARD IN A TERMINAL -- the engine-agnosticism proof.
 *
 *   npm run world          # in one terminal
 *   npm run chat           # in another
 *
 * This connects to the SAME running world as the browser and replays the SAME
 * beat stream through the SAME SurfaceAdapter interface -- into text instead of
 * a GPU. Both windows show one canon. Nothing about the simulation changes.
 *
 * Commands: /visit  /side <text>  /leave  /mint <sheet>  /quit
 *
 * --solo runs a private world in-process instead of attaching, for when you
 * want the text surface with no browser at all.
 *
 * A Telegram bot is the same file with `write` pointing at sendMessage and the
 * commands arriving as messages; see README > Assumptions.
 */

import { createInterface } from "node:readline";
import { ChatSurface } from "../src/runtime/chatSurface.js";
import type { SurfaceAdapter } from "../src/runtime/surface.js";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld, CHARACTERS } from "../src/canon/seed.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { mintFromText } from "../src/canon/mint.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const SOLO = argv.includes("--solo");
const PORT = Number(argv[argv.indexOf("--port") + 1]) || 8787;
const VISITOR = { id: "wren", name: "Wren" };

const surface = new ChatSurface();

/**
 * Map one broadcast beat onto the adapter. This is the whole bridge: the
 * transport carries beats, the adapter renders them, and neither knows about
 * the other's medium.
 */
function apply(target: SurfaceAdapter, beat: Record<string, unknown>): void {
  switch (beat.t) {
    case "spawn":
      target.spawn?.(beat.actor as never);
      break;
    case "despawn":
      target.despawn?.(beat.id as string);
      break;
    case "move":
      target.moveTo?.(beat.id as string, beat.at as never);
      break;
    case "say":
      target.present({
        character_id: beat.id as string,
        action: { verb: beat.verb, target: beat.target },
        lines: (beat.lines as string[]) ?? [],
        post_draft: (beat.post as string) ?? null,
        cites: (beat.cites as string[]) ?? [],
      } as never);
      // Show the citation resolved against the log, same as the 3D surface.
      for (const d of (beat.citeDetail as CiteDetail[]) ?? []) {
        console.log(`   ${d.ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${d.id} — ${d.summary}\x1b[0m`);
      }
      break;
    case "notice":
      target.postNotice?.(beat.text as string, beat.author as string);
      break;
    case "event":
      target.onEvent?.({ type: beat.kind, payload: { summary: beat.summary } } as never);
      break;
  }
}

async function attached(): Promise<void> {
  const { default: WebSocket } = await import("ws");
  const url = `ws://localhost:${PORT}`;
  console.log(`\n  Tallow Ward — text surface. Attaching to ${url}\n`);

  const sock = new WebSocket(url);
  // Typed (or piped) input can beat the handshake. Hold it rather than throw.
  const pending: string[] = [];
  sock.on("open", () => {
    console.log("  connected. /visit  /side <text>  /leave  /mint <sheet>  /quit\n");
    for (const m of pending.splice(0)) sock.send(m);
  });
  sock.on("error", () => {
    console.error(`  Nothing is listening on ${url}. Start it with:  npm run world`);
    console.error(`  Or run a private world with no browser:        npm run chat -- --solo\n`);
    process.exit(1);
  });
  sock.on("close", () => {
    console.log("\n  world closed the connection.");
    process.exit(0);
  });
  sock.on("message", (raw: unknown) => {
    const m = JSON.parse(String(raw)) as Record<string, unknown>;
    if (m.t === "hello") {
      for (const a of (m.actors as { actor: SurfaceActorLike }[]) ?? []) {
        surface.spawn?.(a.actor as never);
      }
      return;
    }
    apply(surface, m);
  });

  prompt((t, text) => {
    const msg = JSON.stringify({ t, text });
    if (sock.readyState === 1) sock.send(msg);
    else pending.push(msg);
  });
}

interface CiteDetail {
  id: string;
  ts: string;
  summary: string;
  ok: boolean;
}

interface SurfaceActorLike {
  id: string;
  name: string;
}

async function solo(): Promise<void> {
  setLogLevel("warn");
  const clock = new VirtualClock("2026-03-02T08:00:00.000Z");
  const repo = CanonRepo.open(":memory:", clock);
  seedWorld(repo);
  // THE SEAM. Mock unless INSPIRAL_HOST=minds and a key is present;
  // createHostRuntime falls back to mock rather than crashing if it is not.
  const host = await startHostRuntime({ ...loadConfig(), seed: 1 });

  const ctx: TickContext = {
    repo,
    host,
    surface,
    dailyBudget: 500,
    clock,
    advanceMs: 4 * HOUR_MS,
  };

  console.log(`\n  Tallow Ward — text surface, private world.  HOST RUNTIME: ${host.name.toUpperCase()}\n`);
  for (const c of CHARACTERS) {
    surface.spawn({
      id: c.character_id,
      name: c.name,
      kind: "character",
      title: c.title,
      home: c.home_location,
    });
  }
  console.log("\n  /visit  /side <text>  /leave  /mint <sheet>  /tick  /quit\n");

  const timer = setInterval(() => void runTick(ctx), 7000);

  prompt(async (t, text) => {
    if (t === "arrive") {
      const returning = repo.visitorExists(VISITOR.id);
      surface.spawn({ id: VISITOR.id, name: VISITOR.name, kind: "visitor", home: "gate" });
      repo.setPresence(VISITOR.id, true);
      await (returning
        ? visitorAction(ctx, VISITOR.id, "returned to the ward after days away")
        : onboardVisitor(ctx, VISITOR.id, VISITOR.name));
    } else if (t === "act" && text) {
      await visitorAction(ctx, VISITOR.id, text);
    } else if (t === "leave") {
      repo.setPresence(VISITOR.id, false);
      surface.despawn(VISITOR.id);
    } else if (t === "mint" && text) {
      const { sheet } = mintFromText(repo, text);
      surface.spawn({
        id: sheet.character_id,
        name: sheet.name,
        kind: "character",
        title: sheet.title,
        home: sheet.home_location,
      });
      await runTick(ctx);
    } else if (t === "tick") {
      await runTick(ctx);
    }
  }, () => {
    clearInterval(timer);
    repo.close();
  });
}

function prompt(
  send: (t: string, text?: string) => void | Promise<void>,
  onQuit: () => void = () => {},
): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  rl.on("line", (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const text = rest.join(" ");
    switch (cmd) {
      case "/visit":
        void send("arrive");
        break;
      case "/side":
        void send("act", text || "backed okonkwo against vance in front of the whole ward");
        break;
      case "/leave":
        void send("leave");
        break;
      case "/mint":
        void send("mint", text || "Name: Halric Vaas\nTitle: Wharfmaster\nFaction: The Wet Quarter");
        break;
      case "/tick":
        void send("tick");
        break;
      case "/quit":
        onQuit();
        process.exit(0);
        break;
      default:
        if (cmd) console.log("  commands: /visit  /side <text>  /leave  /mint <sheet>  /quit");
    }
  });
}

void (SOLO ? solo() : attached()).catch((e) => {
  console.error(e);
  process.exit(1);
});
