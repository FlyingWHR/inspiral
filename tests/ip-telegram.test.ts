import { describe, expect, it } from "vitest";
import { TelegramApprovalChannel, createApprovalChannel, type FetchLike } from "../src/approval/index.js";

/**
 * The Telegram gate against a fake Bot API.
 *
 * This cannot prove Telegram accepts our payloads -- only a live bot does that.
 * It does pin the wire format, the decision mapping and the chat-id discovery,
 * so the only thing left unproven is the network hop.
 */
type Call = { method: string; body: Record<string, unknown> };

function fakeApi(responses: Record<string, unknown[]>): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queues: Record<string, unknown[]> = { ...responses };
  const fetchImpl: FetchLike = async (url, init) => {
    const method = url.split("/").pop()!;
    calls.push({ method, body: JSON.parse(init.body) as Record<string, unknown> });
    const next = queues[method]?.shift() ?? { ok: true, result: [] };
    return { json: async () => next };
  };
  return { fetchImpl, calls };
}

const chatUpdate = (id: number) => ({
  ok: true,
  result: [{ update_id: 1, message: { text: "hi", chat: { id } } }],
});

const review = { title: "Approve?", body: "the bible", draft: { world_name: "Trade Clash" } };

describe("the Telegram approval gate", () => {
  it("discovers the chat from whoever messaged the bot, when no chat id is set", async () => {
    const { fetchImpl, calls } = fakeApi({ getUpdates: [chatUpdate(4242)] });
    const ch = new TelegramApprovalChannel({ token: "t", fetchImpl });
    await ch.notify("hello");
    expect(calls[0]!.method).toBe("getUpdates");
    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.body.chat_id).toBe("4242");
    expect(sent.body.text).toBe("hello");
  });

  it("says exactly what to do when nobody has messaged the bot", async () => {
    const { fetchImpl } = fakeApi({ getUpdates: [{ ok: true, result: [] }] });
    const ch = new TelegramApprovalChannel({ token: "t", fetchImpl });
    await expect(ch.notify("hello")).rejects.toThrow(/Send your bot any message once/);
  });

  it("splits a long digest into messages Telegram will accept", async () => {
    const { fetchImpl, calls } = fakeApi({ getUpdates: [chatUpdate(1)] });
    await new TelegramApprovalChannel({ token: "t", chatId: "1", fetchImpl }).notify("x".repeat(9000));
    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends).toHaveLength(3);
    for (const s of sends) expect(String(s.body.text).length).toBeLessThanOrEqual(4096);
  });

  it("offers approve and reject as buttons, and approves on the button", async () => {
    const { fetchImpl, calls } = fakeApi({
      getUpdates: [{ ok: true, result: [{ update_id: 7, callback_query: { id: "c1", data: "approve" } }] }],
    });
    const ch = new TelegramApprovalChannel({ token: "t", chatId: "9", fetchImpl });
    expect(await ch.review(review)).toEqual({ verdict: "approve" });

    const keyboard = calls.find((c) => c.body.reply_markup)!;
    const rows = (keyboard.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] })
      .inline_keyboard[0]!;
    expect(rows.map((b) => b.callback_data)).toEqual(["approve", "reject"]);
    // The draft is shown before the buttons, or the owner is approving blind.
    expect(String(calls.find((c) => c.method === "sendMessage")!.body.text)).toContain("the bible");
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
  });

  it("rejects on the button", async () => {
    const { fetchImpl } = fakeApi({
      getUpdates: [{ ok: true, result: [{ update_id: 7, callback_query: { id: "c1", data: "reject" } }] }],
    });
    const d = await new TelegramApprovalChannel({ token: "t", chatId: "9", fetchImpl }).review(review);
    expect(d.verdict).toBe("reject");
  });

  it("treats a JSON reply as an edit", async () => {
    const { fetchImpl } = fakeApi({
      getUpdates: [
        { ok: true, result: [{ update_id: 7, message: { text: '{"world_name":"Season Four"}', chat: { id: 9 } } }] },
      ],
    });
    const d = await new TelegramApprovalChannel({ token: "t", chatId: "9", fetchImpl }).review(review);
    expect(d).toEqual({ verdict: "edit", patch: { world_name: "Season Four" } });
  });

  it("treats prose as a rejection with that reason, rather than guessing at it", async () => {
    const { fetchImpl } = fakeApi({
      getUpdates: [{ ok: true, result: [{ update_id: 7, message: { text: "Cindra sounds wrong", chat: { id: 9 } } }] }],
    });
    const d = await new TelegramApprovalChannel({ token: "t", chatId: "9", fetchImpl }).review(review);
    expect(d).toEqual({ verdict: "reject", reason: "Cindra sounds wrong" });
  });

  it("times out CLOSED: silence is not consent", async () => {
    const { fetchImpl } = fakeApi({});
    const ch = new TelegramApprovalChannel({ token: "t", chatId: "9", fetchImpl, timeoutMs: 1 });
    const d = await ch.review(review);
    expect(d.verdict).toBe("reject");
    expect((d as { reason: string }).reason).toMatch(/timed out/);
  });

  it("activates on the token alone, and never without it", () => {
    expect(createApprovalChannel({ TELEGRAM_BOT_TOKEN: "t" } as NodeJS.ProcessEnv).name).toBe("telegram");
    expect(
      createApprovalChannel({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "9" } as NodeJS.ProcessEnv).name,
    ).toBe("telegram");
    expect(createApprovalChannel({} as NodeJS.ProcessEnv).name).toBe("cli");
    expect(createApprovalChannel({ TELEGRAM_CHAT_ID: "9" } as NodeJS.ProcessEnv).name).toBe("cli");
  });
});
