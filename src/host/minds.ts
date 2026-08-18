import type { HostRequest, HostResponse, HostRuntime } from "./HostRuntime.js";
import { log } from "../log.js";

/**
 * The real host: one Mind on the Minds Builder API.
 *
 * ARCHITECTURE CONSTRAINT, NOT A SIMPLIFICATION.
 * The Builder API has no mind-to-mind Circles and the free tier is three
 * Minds. So Inspiral uses exactly ONE Mind. All three faction leaders are
 * server-side projections of it: the Mind is asked "what does this district do
 * next", and the character runtime renders each resulting directive in the
 * right voice. There are no three agents talking to each other, because that
 * is not a thing this platform does -- and because invocations would then
 * scale with cast size, which is the wrong cost curve.
 *
 * Host invocations scale with NARRATIVE DECISIONS: ticks, escalations,
 * onboards. Never with cast size. Never with visitor traffic.
 *
 * The four conversation aliases are lanes on that single Mind, not separate
 * agents:
 *   tick        -- the world tick
 *   onboard     -- a visitor's first contact
 *   fan-events  -- a visitor did something
 *   qc          -- tone and continuity checks
 *
 * Verified against @animocabrands/minds-client-lib@0.1.3 type definitions.
 */

const MODULE_ID = "@animocabrands/minds-client-lib";

/**
 * Structural subset of the client we depend on. Declared locally so this file
 * type-checks whether or not the optional dependency is installed, and so the
 * exact surface we rely on is auditable in one place.
 */
interface MindsClientLike {
  listMinds(opts?: { humanId?: string; signal?: AbortSignal }): Promise<{ mindId: string; name?: string | null }[]>;
  ensureConversation(alias: string, mindId: string): Promise<unknown>;
  sendMessage(body: { alias: string; messageText: string }): Promise<Record<string, unknown>>;
  getLatestHistoryFingerprint(alias: string, signal?: AbortSignal): Promise<string | undefined>;
  waitForReply(opts: {
    alias: string;
    timeoutMs: number;
    signal?: AbortSignal;
    sentMessageText?: string;
    afterFingerprint?: string;
  }): Promise<{ timedOut: true } | { timedOut: false; reply: { messageText?: string | null } }>;
  subscribeEvents(opts: {
    alias?: string;
    onEvent: (e: Record<string, unknown>) => void;
    onError?: (err: Error) => void;
    signal?: AbortSignal;
  }): { close(): void };
  getCognitionBalance(mindId: string, signal?: AbortSignal): Promise<{ mindId: string; cognition: number }>;
}

interface MindsModuleLike {
  createMindsClient(options?: { builderApiKey?: string }): MindsClientLike;
  BUILDER_API_KEY_ENV: string;
}

export interface MindsHostOptions {
  builderApiKey: string;
  mindId?: string | undefined;
  timeoutMs?: number;
  aliases?: { tick: string; onboard: string; fanEvents: string; qc: string };
}

export class MindsHostRuntime implements HostRuntime {
  readonly name = "minds";

  private client: MindsClientLike | null = null;
  private mindId: string | undefined;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly aliases: { tick: string; onboard: string; fanEvents: string; qc: string };
  private subscription: { close(): void } | null = null;
  private ready = false;

  constructor(opts: MindsHostOptions) {
    this.apiKey = opts.builderApiKey;
    this.mindId = opts.mindId;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.aliases = opts.aliases ?? {
      tick: "tick",
      onboard: "onboard",
      fanEvents: "fan-events",
      qc: "qc",
    };
  }

  /** Which conversation lane a call kind uses. */
  private aliasFor(kind: HostRequest["kind"]): string {
    switch (kind) {
      case "onboard":
        return this.aliases.onboard;
      case "fan-event":
        return this.aliases.fanEvents;
      case "qc":
        return this.aliases.qc;
      case "repair":
      case "tick":
      default:
        return this.aliases.tick;
    }
  }

  async init(): Promise<void> {
    if (this.ready) return;

    let mod: MindsModuleLike;
    try {
      // Variable specifier: keeps this file compiling when the optional
      // dependency is absent, which is the default install.
      mod = (await import(MODULE_ID)) as unknown as MindsModuleLike;
    } catch (e) {
      throw new Error(
        `INSPIRAL_HOST=minds but ${MODULE_ID} is not installed. Run: npm install ${MODULE_ID}\n` +
          `Original error: ${(e as Error).message}`,
      );
    }

    if (!this.apiKey) {
      throw new Error(
        `INSPIRAL_HOST=minds requires a Builder API key in ${mod.BUILDER_API_KEY_ENV ?? "MINDS_BUILDER_API_KEY"}.`,
      );
    }

    this.client = mod.createMindsClient({ builderApiKey: this.apiKey });

    if (!this.mindId) {
      const minds = await this.client.listMinds();
      const first = minds[0];
      if (!first) {
        throw new Error(
          "No Minds on this builder account. Create one at build.hellominds.ai/console, " +
            "or set INSPIRAL_MIND_ID.",
        );
      }
      this.mindId = first.mindId;
      log.info(`using Mind ${first.mindId}${first.name ? ` (${first.name})` : ""}`);
    }

    // One Mind, four lanes. ensureConversation handles the already-exists case.
    for (const alias of Object.values(this.aliases)) {
      await this.client.ensureConversation(alias, this.mindId);
    }

    this.ready = true;
  }

  async ask(req: HostRequest): Promise<HostResponse> {
    const started = Date.now();
    try {
      if (!this.ready) await this.init();
      const client = this.client!;
      const alias = this.aliasFor(req.kind);

      // Anchor reply detection before sending, so a reply that lands fast is
      // not missed and an older message is not mistaken for the answer.
      let afterFingerprint: string | undefined;
      try {
        afterFingerprint = await client.getLatestHistoryFingerprint(alias);
      } catch {
        afterFingerprint = undefined; // non-fatal; waitForReply still works
      }

      await client.sendMessage({ alias, messageText: req.prompt });

      const outcome = await client.waitForReply({
        alias,
        timeoutMs: this.timeoutMs,
        sentMessageText: req.prompt,
        ...(afterFingerprint ? { afterFingerprint } : {}),
      });

      const latencyMs = Date.now() - started;

      if (outcome.timedOut) {
        return {
          ok: false,
          reason: "timeout",
          message: `no reply on alias '${alias}' within ${this.timeoutMs}ms`,
          latencyMs,
        };
      }

      const text = outcome.reply.messageText ?? "";
      if (text.trim() === "") {
        return { ok: false, reason: "error", message: "empty reply from Mind", latencyMs };
      }
      return { ok: true, text, latencyMs };
    } catch (e) {
      // ask() must never throw. A dead host is a skipped tick, not a crash.
      return {
        ok: false,
        reason: "error",
        message: (e as Error).message,
        latencyMs: Date.now() - started,
      };
    }
  }

  async budgetRemaining(): Promise<number | undefined> {
    try {
      if (!this.ready) await this.init();
      if (!this.client || !this.mindId) return undefined;
      const bal = await this.client.getCognitionBalance(this.mindId);
      return bal.cognition;
    } catch {
      return undefined;
    }
  }

  /**
   * Live inbound stream on the fan-events lane. Optional -- the tick loop does
   * not need it. Useful when an engine pushes visitor actions in real time.
   */
  subscribeFanEvents(onEvent: (e: Record<string, unknown>) => void): () => void {
    if (!this.client) throw new Error("call init() before subscribeFanEvents()");
    this.subscription = this.client.subscribeEvents({
      alias: this.aliases.fanEvents,
      onEvent,
      onError: (err) => log.warn(`SSE error: ${err.message}`),
    });
    return () => this.subscription?.close();
  }

  async close(): Promise<void> {
    try {
      this.subscription?.close();
    } catch {
      /* noop */
    }
    this.subscription = null;
  }
}
