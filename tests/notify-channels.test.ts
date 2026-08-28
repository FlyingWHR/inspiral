import { describe, expect, it } from "vitest";
import {
  ConsoleChannel,
  FileChannel,
  TelegramChannel,
  WebhookChannel,
  assertSafeWebhookUrl,
  createChannels,
  type FetchLike,
} from "../src/notify/channels.js";
import type { Delivery } from "../src/notify/contract.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("silent"); // the factory announces itself; tests do not need to hear it

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  fan_id: "fan_1",
  address: "",
  headline: "Ada built on your work in Trade Clash",
  body: "She took the ledger and made it lie.",
  url: "https://example.test/?fan=fan_1",
  ids: [1, 2],
  ...over,
});

type Call = { url: string; init: Parameters<FetchLike>[1] };

/** A fetch that records and answers from a queue. Same trick as ip-telegram. */
function fake(answers: unknown[] = [{ ok: true }], status = 200): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(next) };
  };
  return { fetchImpl, calls };
}

/** Never answers. Only the timeout can end it -- which is the point. */
const hang: FetchLike = (_url, init) =>
  new Promise((_ok, fail) => init.signal.addEventListener("abort", () => fail(init.signal.reason)));

describe("ConsoleChannel", () => {
  it("prints the headline, the body and the link", async () => {
    const seen: string[] = [];
    await new ConsoleChannel({ out: (s) => seen.push(s) }).send(delivery());
    const text = seen.join("");
    expect(text).toContain("Ada built on your work");
    // The sentence is the reason to come back. A channel that drops it is
    // delivering "you have 1 update", which the contract forbids.
    expect(text).toContain("She took the ledger and made it lie.");
    expect(text).toContain("https://example.test/?fan=fan_1");
  });

  it("throws instead of swallowing when the sink fails", async () => {
    const ch = new ConsoleChannel({
      out: () => {
        throw new Error("stdout is gone");
      },
    });
    await expect(ch.send(delivery())).rejects.toThrow("stdout is gone");
  });
});

describe("TelegramChannel", () => {
  it("sends to the address as the chat id", async () => {
    const { fetchImpl, calls } = fake();
    await new TelegramChannel({ token: "t", fetchImpl }).send(delivery({ address: "555" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/bott/sendMessage");
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body.chat_id).toBe("555");
    expect(String(body.text)).toContain("She took the ledger");
    expect(String(body.text)).toContain("https://example.test/?fan=fan_1");
  });

  it("falls back to the configured chat, then to whoever messaged the bot", async () => {
    const configured = fake();
    await new TelegramChannel({ token: "t", chatId: "77", fetchImpl: configured.fetchImpl }).send(
      delivery(),
    );
    expect(JSON.parse(configured.calls[0]!.init.body).chat_id).toBe("77");

    const discovered = fake([
      { ok: true, result: [{ update_id: 1, message: { text: "hi", chat: { id: 4242 } } }] },
      { ok: true },
    ]);
    await new TelegramChannel({ token: "t", fetchImpl: discovered.fetchImpl }).send(delivery());
    expect(discovered.calls[0]!.url).toContain("getUpdates");
    expect(JSON.parse(discovered.calls[1]!.init.body).chat_id).toBe("4242");
  });

  it("says exactly what to do when no chat is known anywhere", async () => {
    const { fetchImpl } = fake([{ ok: true, result: [] }]);
    await expect(new TelegramChannel({ token: "t", fetchImpl }).send(delivery())).rejects.toThrow(
      /send the bot any message once/,
    );
  });

  it("splits a long body into messages Telegram will accept", async () => {
    const { fetchImpl, calls } = fake();
    await new TelegramChannel({ token: "t", fetchImpl }).send(
      delivery({ address: "1", body: "x".repeat(9000) }),
    );
    expect(calls).toHaveLength(3);
    for (const c of calls)
      expect(String(JSON.parse(c.init.body).text).length).toBeLessThanOrEqual(4096);
  });

  it("throws on ok:false, which Telegram serves with a 200", async () => {
    const { fetchImpl } = fake([{ ok: false, description: "chat not found" }]);
    await expect(
      new TelegramChannel({ token: "t", fetchImpl }).send(delivery({ address: "9" })),
    ).rejects.toThrow(/chat not found/);
  });

  it("throws on an http failure, without putting the body in the error", async () => {
    const { fetchImpl } = fake([{}], 502);
    const err = await new TelegramChannel({ token: "t", fetchImpl })
      .send(delivery({ address: "9" }))
      .catch((e: Error) => e);
    // This message lands in a database column and a log line.
    expect((err as Error).message).toContain("http 502");
    expect((err as Error).message).not.toContain("ledger");
  });

  it("gives up rather than hanging the whole queue", async () => {
    const ch = new TelegramChannel({ token: "t", timeoutMs: 5, fetchImpl: hang });
    await expect(ch.send(delivery({ address: "1" }))).rejects.toThrow(/abort|timeout/i);
  });
});

describe("WebhookChannel", () => {
  it("posts the four fields as JSON, and passes a timeout signal", async () => {
    const { fetchImpl, calls } = fake();
    await new WebhookChannel({ fetchImpl }).send(
      delivery({ address: "https://hooks.example.test/abc" }),
    );
    expect(calls[0]!.url).toBe("https://hooks.example.test/abc");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      fan_id: "fan_1",
      headline: "Ada built on your work in Trade Clash",
      body: "She took the ledger and made it lie.",
      url: "https://example.test/?fan=fan_1",
    });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    // A public URL that redirects to the metadata endpoint is still an SSRF.
    expect(calls[0]!.init.redirect).toBe("manual");
  });

  it("uses the configured default when a person has no address of their own", async () => {
    const { fetchImpl, calls } = fake();
    await new WebhookChannel({ url: "https://default.example.test/hook", fetchImpl }).send(delivery());
    expect(calls[0]!.url).toBe("https://default.example.test/hook");
  });

  it("throws when there is no address and no default", async () => {
    await expect(new WebhookChannel({ fetchImpl: fake().fetchImpl }).send(delivery())).rejects.toThrow(
      /INSPIRAL_WEBHOOK_URL/,
    );
  });

  it("throws on a non-2xx, naming the host but not the path", async () => {
    const { fetchImpl } = fake([{}], 500);
    const err = await new WebhookChannel({ fetchImpl })
      .send(delivery({ address: "https://hooks.example.test/secret-token-in-path" }))
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("500");
    expect((err as Error).message).toContain("hooks.example.test");
    expect((err as Error).message).not.toContain("secret-token-in-path");
  });

  it("gives up rather than hanging the whole queue", async () => {
    const ch = new WebhookChannel({ timeoutMs: 5, fetchImpl: hang });
    await expect(ch.send(delivery({ address: "https://slow.example.test/h" }))).rejects.toThrow(
      /abort|timeout/i,
    );
  });

  // The address is user-supplied and this server fetches it. Each of these is a
  // real place somebody has exfiltrated credentials from.
  const refused = [
    "file:///etc/passwd",
    "gopher://example.test/",
    "javascript:alert(1)",
    "http://localhost:8080/hook",
    "http://LOCALHOST/hook",
    "http://api.internal/hook",
    "http://127.0.0.1/hook",
    "http://127.0.0.1:22/hook",
    "http://127.1/hook", // normalised to 127.0.0.1 by the URL parser
    "http://2130706433/hook", // decimal 127.0.0.1
    "http://0.0.0.0/hook",
    "http://169.254.169.254/latest/meta-data/", // cloud credentials
    "http://10.0.0.5/hook",
    "http://172.16.4.4/hook",
    "http://172.31.255.1/hook",
    "http://192.168.1.1/hook",
    "http://100.64.0.1/hook",
    "http://[::1]:9000/hook",
    "http://[fd00::1]/hook",
    "http://[fe80::1]/hook",
    "not a url at all",
  ];
  it.each(refused)("refuses %s", async (address) => {
    const { fetchImpl, calls } = fake();
    await expect(new WebhookChannel({ fetchImpl }).send(delivery({ address }))).rejects.toThrow(
      /refusing|not a URL/,
    );
    expect(calls).toHaveLength(0); // refused means never fetched, not fetched and discarded
  });

  const allowed = ["http://93.184.216.34/hook", "https://hooks.example.test/x", "http://172.32.0.1/h"];
  it.each(allowed)("allows %s", async (address) => {
    const { fetchImpl, calls } = fake();
    await new WebhookChannel({ fetchImpl }).send(delivery({ address }));
    expect(calls).toHaveLength(1);
  });

  it("lets a developer point it at their own laptop with the flag", async () => {
    const { fetchImpl, calls } = fake();
    await new WebhookChannel({ allowPrivate: true, fetchImpl }).send(
      delivery({ address: "http://127.0.0.1:3000/hook" }),
    );
    expect(calls).toHaveLength(1);
    // The flag is about private ranges, not about protocols.
    await expect(
      new WebhookChannel({ allowPrivate: true, fetchImpl }).send(delivery({ address: "file:///etc/passwd" })),
    ).rejects.toThrow(/http\(s\) only/);
  });

  it("refuses a bad default at construction, not on the first delivery", () => {
    expect(() => new WebhookChannel({ url: "http://169.254.169.254/" })).toThrow(/refusing/);
    expect(() => new WebhookChannel({ url: "http://169.254.169.254/", allowPrivate: true })).not.toThrow();
  });

  it("exports the guard on its own, so nothing has to fetch to test it", () => {
    expect(assertSafeWebhookUrl("https://ok.example.test/x").host).toBe("ok.example.test");
    expect(() => assertSafeWebhookUrl("http://10.1.1.1/x")).toThrow();
  });
});

describe("FileChannel", () => {
  it("appends one parseable JSON object per delivery, in order", async () => {
    const lines: string[] = [];
    const ch = new FileChannel({
      path: "/tmp/does-not-exist.jsonl",
      appendImpl: async (_p, line) => {
        lines.push(line);
      },
      now: () => "2026-08-28T00:00:00.000Z",
    });
    await ch.send(delivery());
    await ch.send(delivery({ fan_id: "fan_2" }));
    await ch.close();

    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.endsWith("\n")).toBe(true);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first).toMatchObject({
      ts: "2026-08-28T00:00:00.000Z",
      fan_id: "fan_1",
      headline: "Ada built on your work in Trade Clash",
      url: "https://example.test/?fan=fan_1",
    });
    expect(JSON.parse(lines[1]!).fan_id).toBe("fan_2");
  });

  it("throws when the disk does, and stays usable afterwards", async () => {
    let fail = true;
    const lines: string[] = [];
    const ch = new FileChannel({
      path: "/tmp/x.jsonl",
      appendImpl: async (_p, line) => {
        if (fail) throw new Error("ENOSPC");
        lines.push(line);
      },
    });
    await expect(ch.send(delivery())).rejects.toThrow("ENOSPC");
    // One failure must not poison the write chain for everybody behind it.
    fail = false;
    await ch.send(delivery({ fan_id: "fan_3" }));
    expect(JSON.parse(lines[0]!).fan_id).toBe("fan_3");
  });

  it("really writes a file, since the injected fs proves nothing about fs", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "inspiral-notify-"));
    const path = join(dir, "nested", "out.jsonl"); // the directory does not exist yet
    const ch = new FileChannel({ path });
    await ch.send(delivery());
    await ch.close();
    expect(JSON.parse((await readFile(path, "utf8")).trim()).fan_id).toBe("fan_1");
  });
});

describe("createChannels", () => {
  const names = (env: NodeJS.ProcessEnv) => createChannels(env).map((c) => c.name);

  it("gives a bare environment a working channel", () => {
    expect(names({})).toEqual(["console"]);
  });

  it("adds exactly what the environment configures", () => {
    expect(names({ TELEGRAM_BOT_TOKEN: "t" })).toEqual(["console", "telegram"]);
    expect(names({ INSPIRAL_WEBHOOK_URL: "https://h.example.test/x" })).toEqual(["console", "webhook"]);
    expect(names({ INSPIRAL_NOTIFY_FILE: "./data/notify.jsonl" })).toEqual(["console", "file"]);
    expect(
      names({
        TELEGRAM_BOT_TOKEN: "t",
        INSPIRAL_WEBHOOK_URL: "https://h.example.test/x",
        INSPIRAL_NOTIFY_FILE: "./data/notify.jsonl",
      }),
    ).toEqual(["console", "telegram", "webhook", "file"]);
  });

  it("ignores empty values rather than building a channel that cannot work", () => {
    expect(names({ TELEGRAM_BOT_TOKEN: "", INSPIRAL_WEBHOOK_URL: "", INSPIRAL_NOTIFY_FILE: "" })).toEqual([
      "console",
    ]);
  });

  it("refuses to start with an internal webhook target unless told to", () => {
    expect(() => createChannels({ INSPIRAL_WEBHOOK_URL: "http://127.0.0.1:3000/hook" })).toThrow(
      /refusing/,
    );
    expect(
      names({ INSPIRAL_WEBHOOK_URL: "http://127.0.0.1:3000/hook", INSPIRAL_WEBHOOK_ALLOW_PRIVATE: "1" }),
    ).toEqual(["console", "webhook"]);
  });

  it("names channels exactly as a preference row spells them", () => {
    // dispatch() matches channels.find(c => c.name === pref.channel). A rename
    // here silently stops delivering to everybody who chose that channel.
    expect(names({ TELEGRAM_BOT_TOKEN: "t", INSPIRAL_NOTIFY_FILE: "f" })).toEqual([
      "console",
      "telegram",
      "file",
    ]);
  });
});
