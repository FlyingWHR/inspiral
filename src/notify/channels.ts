/**
 * TRANSPORT. NOTHING ELSE.
 *
 * Every judgement about whether a person should be reached today -- batching,
 * quiet windows, opt-outs, takedown suppression -- lives in dispatch.ts. A
 * channel here is handed a finished `Delivery` and its only job is to put it in
 * front of somebody. If a channel ever grows an `if` about whether to send, two
 * routes will disagree and somebody gets messaged twice about one thing.
 *
 * So the rules for everything in this file are short:
 *
 *   - `send` throws on failure. It never swallows, never retries, never marks
 *     anything. The dispatcher counts attempts and gives up at MAX_ATTEMPTS;
 *     a channel that hides a failure turns a stuck queue into a silent one.
 *   - Every outbound request carries a timeout. The dispatcher awaits channels
 *     serially, so one hung socket stalls everybody else's notifications.
 *   - Nothing logs an address or a body above debug. A notification body is
 *     somebody's private content and errors here land in a database column and
 *     a warn line.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Delivery, NotifyChannel } from "./contract.js";
import { log } from "../log.js";

/** A hung channel stalls the queue, so nothing waits forever. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Just enough of `fetch` to be swappable in tests, same trick as the approval
 * channel. `signal` is required rather than optional: a timeout you can forget
 * to pass is a timeout you will forget to pass.
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect?: "manual" | "follow";
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const realFetch: FetchLike = (url, init) =>
  fetch(url, init) as unknown as ReturnType<FetchLike>;

/** Enough to tell two addresses apart in a log; not enough to be one. */
function redact(address: string): string {
  if (address.length <= 6) return `${address.slice(0, 2)}***`;
  return `${address.slice(0, 3)}***${address.slice(-2)}`;
}

/** The one text rendering, so every channel shows the same three things. */
function asText(d: Delivery): string {
  return `${d.headline}\n\n${d.body}\n\n${d.url}`;
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

/**
 * What a developer sees, and what most tests use. Zero config, always
 * available, no network -- so `dispatch` can be exercised end to end with
 * nothing configured at all.
 *
 * This prints the body on purpose: here the body IS the transport, not a log
 * line. That is exactly why it is a separate function from `log.info`, which
 * must never carry one.
 */
export class ConsoleChannel implements NotifyChannel {
  readonly name = "console";
  private out: (s: string) => void;

  constructor(opts: { out?: (s: string) => void } = {}) {
    this.out = opts.out ?? ((s) => console.log(s));
  }

  async send(d: Delivery): Promise<void> {
    this.out(`\n--- notify: ${d.fan_id} ---\n${asText(d)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/** Telegram rejects messages over 4096; 4000 leaves room for the split. */
const TG_LIMIT = 4000;

export interface TelegramChannelOptions {
  token: string;
  /** Used when a preference carries no address. Discovered if unset. */
  chatId?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * Bot API over plain fetch. Deliberately NOT the class in src/approval -- that
 * one is a blocking gate that long-polls for a human verdict and owns an update
 * offset. Sharing it would mean this channel competing for the same getUpdates
 * cursor, and a notification would eat the reply to an approval request.
 *
 * `address` is the chat id. Empty falls back to the configured one, then to
 * whoever messaged the bot last -- looking a chat id up by hand is the step
 * that stops people from finishing setup.
 */
export class TelegramChannel implements NotifyChannel {
  readonly name = "telegram";
  private token: string;
  private chatId: string | undefined;
  private timeoutMs: number;
  private fetchImpl: FetchLike;

  constructor(opts: TelegramChannelOptions) {
    this.token = opts.token;
    this.chatId = opts.chatId && opts.chatId !== "" ? opts.chatId : undefined;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? realFetch;
  }

  private async api(method: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
    } catch {
      /* a proxy or an outage can answer with HTML; handled as a failure below */
    }
    // Telegram answers 200 with ok:false, so the status alone proves nothing.
    if (!res.ok || parsed.ok === false) {
      const why = typeof parsed.description === "string" ? parsed.description : `http ${res.status}`;
      throw new Error(`telegram ${method} failed: ${why}`);
    }
    return parsed;
  }

  /** Nothing is ever sent to a chat that has not spoken to the bot first. */
  private async resolveChatId(address: string): Promise<string> {
    if (address) return address;
    if (this.chatId) return this.chatId;
    const r = await this.api("getUpdates", { offset: 0, timeout: 0 });
    for (const u of (r.result as Record<string, unknown>[] | undefined) ?? []) {
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
      "telegram: no chat id for this person. Set their notify address, or set " +
        "TELEGRAM_CHAT_ID, or send the bot any message once.",
    );
  }

  async send(d: Delivery): Promise<void> {
    const chat_id = await this.resolveChatId(d.address);
    const text = asText(d);
    for (let i = 0; i < text.length; i += TG_LIMIT) {
      await this.api("sendMessage", {
        chat_id,
        text: text.slice(i, i + TG_LIMIT),
        disable_web_page_preview: true,
      });
    }
    log.debug(`notify: telegram -> ${redact(chat_id)}`);
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/**
 * SSRF GUARD.
 *
 * The address is user-supplied and this server fetches it, which is the textbook
 * shape of a server-side request forgery: point it at 169.254.169.254 and the
 * POST body comes back with cloud credentials, point it at an internal admin
 * port and the notification queue becomes a remote control for the private
 * network.
 *
 * Refused unless INSPIRAL_WEBHOOK_ALLOW_PRIVATE=1, which exists so a developer
 * can point this at their own laptop.
 *
 * ponytail: this checks the literal host only. A name that RESOLVES to a
 * private address still passes (DNS rebinding). Closing that needs a resolve +
 * pin-the-socket dispatcher; do it if this ever accepts addresses from
 * strangers rather than from people configuring their own delivery.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // Names that never mean "somewhere else on the internet".
  if (host === "localhost" || /\.(localhost|local|internal|home|lan|intranet)$/.test(host))
    return true;

  // IPv6. WHATWG URL already normalised the compressed forms.
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 link local

  // IPv4, including the ::ffff: mapped form. Decimal/octal/hex tricks
  // (http://2130706433/) are already normalised to dotted quads by `new URL`.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped?.[1] ?? host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 || // 0.0.0.0/8 -- "this host"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, and the metadata endpoint with it
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

/** Throws rather than returning null: a refused target must never be fetched. */
export function assertSafeWebhookUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("webhook: address is not a URL");
  }
  // file:, gopher:, and friends reach places http never could.
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`webhook: refusing ${url.protocol} -- http(s) only`);
  if (!allowPrivate && isPrivateHost(url.hostname))
    throw new Error(
      `webhook: refusing internal target ${url.hostname} ` +
        "(set INSPIRAL_WEBHOOK_ALLOW_PRIVATE=1 if you meant it)",
    );
  return url;
}

export interface WebhookChannelOptions {
  /** Default target when a preference carries no address of its own. */
  url?: string;
  allowPrivate?: boolean;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * The escape hatch. Somebody wires email, Slack, Discord, a queue -- anything --
 * without this repo taking a dependency on their vendor. One POST, four fields,
 * no auth scheme invented here: put the secret in the URL if you need one.
 */
export class WebhookChannel implements NotifyChannel {
  readonly name = "webhook";
  private url: string | undefined;
  private allowPrivate: boolean;
  private timeoutMs: number;
  private fetchImpl: FetchLike;

  constructor(opts: WebhookChannelOptions = {}) {
    this.allowPrivate = opts.allowPrivate ?? false;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? realFetch;
    // Fail at construction, not on the first delivery: a typo in the deploy
    // env should be a startup error, not a queue that quietly fails forever.
    if (opts.url) assertSafeWebhookUrl(opts.url, this.allowPrivate);
    this.url = opts.url;
  }

  async send(d: Delivery): Promise<void> {
    const target = d.address || this.url;
    if (!target) throw new Error("webhook: no address and no INSPIRAL_WEBHOOK_URL");
    const url = assertSafeWebhookUrl(target, this.allowPrivate);

    const res = await this.fetchImpl(url.href, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "inspiral-notify" },
      body: JSON.stringify({ fan_id: d.fan_id, headline: d.headline, body: d.body, url: d.url }),
      signal: AbortSignal.timeout(this.timeoutMs),
      // A public URL that 302s to 169.254.169.254 walks straight through a
      // host check done before the request. Do not follow anything.
      redirect: "manual",
    });
    if (!res.ok)
      // Host, not href: the path and query can carry a token.
      throw new Error(`webhook: ${url.protocol}//${url.host} answered ${res.status}`);
    log.debug(`notify: webhook -> ${url.host}`);
  }
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

export interface FileChannelOptions {
  path: string;
  /** Injected in tests, and the seam that keeps this off a real disk. */
  appendImpl?: (path: string, line: string) => Promise<void>;
  now?: () => string;
}

/**
 * Appends one JSON object per line. Two jobs: proving delivery works with no
 * network at all, and leaving an auditable record of what actually went out to
 * whom -- which the notifications table does not hold, because it stores that
 * a message was sent, not what it said.
 */
export class FileChannel implements NotifyChannel {
  readonly name = "file";
  private path: string;
  private now: () => string;
  private append: (path: string, line: string) => Promise<void>;
  /** Writes are chained: concurrent appends of a multi-KB body interleave. */
  private tail: Promise<void> = Promise.resolve();

  constructor(opts: FileChannelOptions) {
    this.path = opts.path;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.append =
      opts.appendImpl ??
      (async (p, line) => {
        await mkdir(dirname(p), { recursive: true });
        await appendFile(p, line, "utf8");
      });
  }

  async send(d: Delivery): Promise<void> {
    const line =
      JSON.stringify({
        ts: this.now(),
        fan_id: d.fan_id,
        address: d.address,
        headline: d.headline,
        body: d.body,
        url: d.url,
      }) + "\n";
    const write = this.tail.then(() => this.append(this.path, line));
    this.tail = write.catch(() => {}); // one failure must not poison the chain
    await write; // ... but the caller still has to see it
  }

  /** Nothing to close, but an in-flight append must not be lost on shutdown. */
  async close(): Promise<void> {
    await this.tail;
  }
}

// ---------------------------------------------------------------------------

/**
 * Same seam as createHostRuntime and createApprovalChannel: one switch, read
 * from the environment, no vendor anything above this line.
 *
 * Console is always present -- it costs nothing, needs no config, and it is the
 * only channel that works for somebody who cloned this five minutes ago. The
 * rest appear only when their environment says so, and a channel that is not
 * built cannot be selected by a preference row, which is the cheap version of
 * "you cannot send through a route you did not configure".
 */
export function createChannels(env: NodeJS.ProcessEnv = process.env): NotifyChannel[] {
  const timeoutMs = num(env.INSPIRAL_NOTIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const channels: NotifyChannel[] = [new ConsoleChannel()];

  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  if (token)
    channels.push(
      new TelegramChannel({ token, chatId: env.TELEGRAM_CHAT_ID ?? "", timeoutMs }),
    );

  // ponytail: a deployment that only uses per-fan URLs still has to set this to
  // something. Give it its own on/off flag if that ever actually bites.
  const hook = env.INSPIRAL_WEBHOOK_URL ?? "";
  if (hook)
    channels.push(
      new WebhookChannel({
        url: hook,
        allowPrivate: env.INSPIRAL_WEBHOOK_ALLOW_PRIVATE === "1",
        timeoutMs,
      }),
    );

  const file = env.INSPIRAL_NOTIFY_FILE ?? "";
  if (file) channels.push(new FileChannel({ path: file }));

  log.info(`notify channels: ${channels.map((c) => c.name).join(", ")}`);
  return channels;
}
