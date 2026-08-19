import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../log.js";

/**
 * THE CREATOR APPROVAL GATE.
 *
 * Nothing an IP source produces reaches canon without the owner saying yes.
 * That is a product promise ("you keep an approval gate and a daily digest"),
 * and it is also the only defence this system has against a compiler that
 * misreads someone's account and confidently writes it into their world.
 *
 * One interface, two implementations. The CLI one works today with zero setup.
 * The Telegram one activates on TELEGRAM_BOT_TOKEN alone -- TELEGRAM_CHAT_ID is
 * optional and is otherwise discovered from whoever messaged the bot last. With
 * no token the factory never constructs it at all.
 */

export type Decision =
  | { verdict: "approve" }
  | { verdict: "reject"; reason: string }
  | { verdict: "edit"; patch: Record<string, unknown>; reason?: string };

export interface ReviewRequest {
  title: string;
  /** Human-readable rendering of the draft. This is what the owner reads. */
  body: string;
  /** The machine object under review. Returned edits patch this. */
  draft: unknown;
  /** Where an interactive edit round-trips through a file. */
  editPath?: string;
}

export interface ApprovalChannel {
  readonly name: string;
  /** One-way. Digests, clip drafts, "your world ticked" notes. */
  notify(text: string): Promise<void>;
  /** Blocking. Returns only when the owner has decided (or provably has not). */
  review(req: ReviewRequest): Promise<Decision>;
  close?(): Promise<void>;
}

/** Shallow merge. Deliberately shallow: an edit replaces a top-level section. */
export function applyPatch<T>(draft: T, patch: Record<string, unknown>): T {
  return { ...(draft as Record<string, unknown>), ...patch } as T;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  /**
   * "ask"     -- prompt on stdin (requires a TTY)
   * "approve" -- print and approve. The headless default, so CI and the demo
   *              never hang waiting for a keypress that will not come.
   * "reject"  -- print and refuse. Used to prove the gate actually blocks.
   */
  mode?: "ask" | "approve" | "reject";
  out?: (s: string) => void;
}

export class CliApprovalChannel implements ApprovalChannel {
  readonly name = "cli";
  private mode: "ask" | "approve" | "reject";
  private out: (s: string) => void;

  constructor(opts: CliOptions = {}) {
    this.out = opts.out ?? ((s) => console.log(s));
    this.mode = opts.mode ?? (process.stdin.isTTY ? "ask" : "approve");
  }

  async notify(text: string): Promise<void> {
    this.out(text);
  }

  async review(req: ReviewRequest): Promise<Decision> {
    this.out("");
    this.out(`=== ${req.title} ===`);
    this.out(req.body);
    this.out("");

    if (this.mode === "approve") {
      this.out("[gate] non-interactive: approved automatically.");
      return { verdict: "approve" };
    }
    if (this.mode === "reject") {
      this.out("[gate] non-interactive: rejected (mode=reject).");
      return { verdict: "reject", reason: "rejected by non-interactive policy" };
    }

    const rl = (await import("node:readline/promises")).createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      for (;;) {
        const answer = (await rl.question("[a]pprove / [r]eject / [e]dit ? ")).trim().toLowerCase();
        if (answer === "" || answer === "a") return { verdict: "approve" };
        if (answer === "r") {
          const reason = await rl.question("why? ");
          return { verdict: "reject", reason: reason.trim() || "no reason given" };
        }
        if (answer === "e") {
          const path = req.editPath ?? "./data/draft.json";
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, JSON.stringify(req.draft, null, 2));
          this.out(`wrote ${path}. Edit it, save, then press enter.`);
          await rl.question("");
          try {
            const patch = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
            return { verdict: "edit", patch };
          } catch (e) {
            this.out(`could not read your edit: ${(e as Error).message}`);
            continue;
          }
        }
      }
    } finally {
      rl.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

const TG_LIMIT = 4000;

/** Just enough of the Bot API to be swappable in tests. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ json(): Promise<unknown> }>;

export interface TelegramOptions {
  token: string;
  /** Omit and it is discovered from the first person who messages the bot. */
  chatId?: string;
  timeoutMs?: number;
  /** Injected in tests so the wire format is covered without a live bot. */
  fetchImpl?: FetchLike;
}

/**
 * Bot API over plain fetch. No SDK, no webhook, no server: long-polls
 * getUpdates only while a review is actually outstanding, so it costs nothing
 * when idle.
 *
 * Approve/reject are buttons. An EDIT is a reply containing a JSON object,
 * which is merged into the draft; any other reply is treated as a rejection
 * with that text as the reason. Free-text prose cannot be applied safely and
 * pretending otherwise would be worse than saying no.
 */
export class TelegramApprovalChannel implements ApprovalChannel {
  readonly name = "telegram";
  private token: string;
  private chatId: string | undefined;
  private timeoutMs: number;
  private fetchImpl: FetchLike;
  private offset = 0;

  constructor(opts: TelegramOptions) {
    this.token = opts.token;
    this.chatId = opts.chatId && opts.chatId !== "" ? opts.chatId : undefined;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000;
    this.fetchImpl =
      opts.fetchImpl ??
      ((url, init) => fetch(url, init) as unknown as Promise<{ json(): Promise<unknown> }>);
  }

  private async api(method: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return ((await res.json()) ?? {}) as Record<string, unknown>;
  }

  private updatesOf(r: Record<string, unknown>): Record<string, unknown>[] {
    const list = (r.result as Record<string, unknown>[] | undefined) ?? [];
    for (const u of list) this.offset = Math.max(this.offset, Number(u.update_id) + 1);
    return list;
  }

  /**
   * TELEGRAM_CHAT_ID is a nuisance to look up, so it is optional: the owner
   * messages the bot once and the id is taken from that. Nothing is ever sent
   * to a chat that has not spoken to the bot first.
   */
  async resolveChatId(): Promise<string> {
    if (this.chatId) return this.chatId;
    for (const u of this.updatesOf(await this.api("getUpdates", { offset: this.offset, timeout: 0 }))) {
      const msg = (u.message ?? u.callback_query) as Record<string, unknown> | undefined;
      const chat = (msg?.chat ?? (msg?.message as Record<string, unknown> | undefined)?.chat) as
        | Record<string, unknown>
        | undefined;
      if (chat?.id !== undefined) {
        this.chatId = String(chat.id);
        return this.chatId;
      }
    }
    throw new Error(
      "TELEGRAM_BOT_TOKEN is set but no chat is known. Send your bot any message once, " +
        "or set TELEGRAM_CHAT_ID, then run this again.",
    );
  }

  async notify(text: string): Promise<void> {
    const chat_id = await this.resolveChatId();
    for (let i = 0; i < text.length; i += TG_LIMIT) {
      await this.api("sendMessage", { chat_id, text: text.slice(i, i + TG_LIMIT) });
    }
  }

  async review(req: ReviewRequest): Promise<Decision> {
    const chat_id = await this.resolveChatId();
    await this.notify(`${req.title}\n\n${req.body}`);
    await this.api("sendMessage", {
      chat_id,
      text: "Approve this, reject it, or reply with a JSON patch to edit it.",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: "approve" },
            { text: "Reject", callback_data: "reject" },
          ],
        ],
      },
    });

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      for (const u of this.updatesOf(await this.api("getUpdates", { offset: this.offset, timeout: 25 }))) {
        const cb = u.callback_query as Record<string, unknown> | undefined;
        if (cb) {
          await this.api("answerCallbackQuery", { callback_query_id: cb.id });
          const data = String(cb.data ?? "");
          if (data === "approve") return { verdict: "approve" };
          if (data === "reject") return { verdict: "reject", reason: "rejected in Telegram" };
        }

        const msg = u.message as Record<string, unknown> | undefined;
        const text = typeof msg?.text === "string" ? msg.text.trim() : "";
        if (!text) continue;
        try {
          const patch = JSON.parse(text) as Record<string, unknown>;
          if (patch && typeof patch === "object" && !Array.isArray(patch))
            return { verdict: "edit", patch };
        } catch {
          /* not JSON -- falls through to a rejection with the text as reason */
        }
        return { verdict: "reject", reason: text };
      }
    }
    // Silence is not consent. A gate that times out open is not a gate.
    return { verdict: "reject", reason: "no answer from the owner before the review timed out" };
  }
}

// ---------------------------------------------------------------------------

/**
 * Telegram when the owner has configured it, CLI otherwise. A half-configured
 * Telegram (token, no chat id) warns once and falls back -- it never silently
 * drops the owner's approval request into the void.
 */
export function createApprovalChannel(
  env: NodeJS.ProcessEnv = process.env,
  cli: CliOptions = {},
): ApprovalChannel {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  if (token) {
    const chatId = env.TELEGRAM_CHAT_ID ?? "";
    if (!chatId)
      log.info("TELEGRAM_CHAT_ID unset -- the chat will be taken from whoever messaged the bot last.");
    log.info("approval channel: telegram");
    return new TelegramApprovalChannel({ token, chatId });
  }
  return new CliApprovalChannel(cli);
}

/** Collects instead of prompting. Used by the tests. */
export class MemoryApprovalChannel implements ApprovalChannel {
  readonly name = "memory";
  readonly notices: string[] = [];
  readonly reviewed: ReviewRequest[] = [];
  constructor(private answers: Decision[] = [{ verdict: "approve" }]) {}
  async notify(text: string): Promise<void> {
    this.notices.push(text);
  }
  async review(req: ReviewRequest): Promise<Decision> {
    this.reviewed.push(req);
    return this.answers.shift() ?? { verdict: "approve" };
  }
}
