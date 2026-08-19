/**
 * What the owner gets back.
 *
 *   npm run digest -- --fixture tradeclash            the showrunner's note
 *   npm run clips  -- --fixture tradeclash --write    clip drafts to ./data/clips/
 *
 * Both go over the configured ApprovalChannel: Telegram when
 * TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, stdout otherwise.
 *
 * Nothing here posts to any feed. Clips are drafts and stay drafts.
 */

import { CanonRepo } from "../src/canon/repo.js";
import { createApprovalChannel } from "../src/approval/index.js";
import {
  defaultClipPath,
  renderClip,
  selectClips,
  sendDailyDigest,
  showrunnerNote,
  writeClips,
} from "../src/ip/outbound.js";
import { systemClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (n: string) => argv.includes(`--${n}`);

setLogLevel("warn");

const fixture = arg("fixture");
const dbPath = arg("db") ?? (fixture ? `./data/${fixture.replace(/[^a-z0-9]+/gi, "_")}.db` : "./data/canon.db");
const hours = Number(arg("hours") ?? 24);

async function main(): Promise<void> {
  const repo = CanonRepo.open(dbPath, systemClock);
  const channel = createApprovalChannel();

  if (has("clips")) {
    const clips = selectClips(repo, { hours, limit: Number(arg("limit") ?? 3), ...(arg("platform") ? { platform: arg("platform")! } : {}) });
    if (clips.length === 0) {
      console.log(`nothing above the significance bar in the last ${hours}h of ${dbPath}`);
    } else {
      await channel.notify(
        ["CLIPS WORTH POSTING (drafts — nothing has been published)", ""]
          .concat(clips.map((c) => renderClip(repo, c)).join("\n\n"))
          .join("\n"),
      );
      if (has("write")) console.log(`\nwrote ${writeClips(repo, clips, arg("out") ?? defaultClipPath(repo))}`);
    }
  } else if (has("note-only")) {
    console.log(showrunnerNote(repo, hours));
  } else {
    await sendDailyDigest(repo, channel, { hours });
  }

  repo.close();
}

main().catch((e) => {
  console.error(`showrunner failed: ${(e as Error).message}`);
  process.exit(1);
});
