# Setup

Paste the block below into a terminal. It is safe to run more than once and it
does not delete anything you have.

## Requirements

- **Node 22 or newer** (`node -v`). The Minds client library requires it.
- macOS or Linux. Nothing else.

No API key. No account. No network calls at runtime. The demo runs against a
deterministic local host.

---

## The block

```bash
mkdir -p ~/ProjectW/Inspiral && cd ~/ProjectW/Inspiral && \
if [ ! -f package.json ] && [ ! -f inspiral/package.json ]; then \
  ZIP=""; for c in ./inspiral.zip ~/Downloads/inspiral.zip ~/Desktop/inspiral.zip; do \
    [ -f "$c" ] && ZIP="$c" && break; done; \
  if [ -z "$ZIP" ]; then echo "Could not find inspiral.zip. Put it in ~/Downloads and rerun."; else \
    echo "Unpacking $ZIP"; unzip -oq "$ZIP" -d .; fi; \
fi && \
[ -f inspiral/package.json ] && cd inspiral || true && \
node -e 'const v=+process.versions.node.split(".")[0];if(v<22){console.error("\n  Node "+process.versions.node+" found; Inspiral needs 22+.\n  Try: nvm install 22 && nvm use 22\n");process.exit(1)}' && \
npm install --no-audit --no-fund && \
npm test && \
npm run demo
```

That is: find and unpack the zip, check Node, install, run the tests, run the
demo. Rerunning it is harmless — it will not re-unzip over a folder that already
has a `package.json`, and it deletes nothing.

If you already unzipped somewhere else, `cd` into the folder containing
`package.json` and run:

```bash
npm install --no-audit --no-fund && npm test && npm run demo
```

---

## What you should see

Six days of world history scrolling past, then a section headed
**THE RETURN VISIT** where an NPC greets the visitor as an ally and complains
about something a rival did while they were away — followed by
**VERIFICATION**, which looks up every cited event id in the append-only log and
prints the day it actually happened.

If verification prints `OK` lines, the whole loop works: canon → digest → host →
validation → deltas → rendered behaviour → grounded callback.

The demo exits non-zero if a citation cannot be resolved, so it is usable as a
smoke test.

---

## Useful commands

```bash
npm run demo                    # six days, in memory, nothing written to disk
npm run demo -- --verbose       # every line of dialogue, every tick
npm run demo -- --days 10       # ten days
npm run demo -- --seed 7        # a different history; same seed = same run
npm run demo -- --persist       # write to ./data/demo.db instead of memory
npm run demo -- --persist --reset   # ...starting from scratch

npm test                        # 48 tests
npm run typecheck

npm run tick                    # one tick against the persistent db
npm run tick -- --watch         # scheduler, every 4h
npm run canon                   # inspect canon state
npm run canon -- --digest       # the exact briefing the host would receive
npm run canon -- --events 40
```

`npm run demo` is in-memory by default, so it never leaves a database behind and
always starts clean.

---

## Connecting the real Mind (later, not needed now)

The mock host is the default and nothing about it needs to change for the demo.
When you want the real thing:

```bash
cp .env.example .env
# edit .env:
#   INSPIRAL_HOST=minds
#   MINDS_BUILDER_API_KEY=<key from build.hellominds.ai/console>
#   INSPIRAL_MIND_ID=<optional; otherwise the first Mind on the account>

npm install @animocabrands/minds-client-lib   # already an optional dependency
npm run tick
```

The client library is listed as an **optional** dependency, so a failed install
of it never blocks the demo. `.env` is gitignored and is not read automatically —
export the variables, or use `node --env-file=.env`:

```bash
node --env-file=.env node_modules/.bin/tsx scripts/tick.ts
```

If `INSPIRAL_HOST=minds` but no key is present, the process logs a warning and
falls back to the mock rather than failing.

---

## If something goes wrong

**`Unsupported engine` or a syntax error on install** — Node is older than 22.
`nvm install 22 && nvm use 22`.

**`better-sqlite3` tries to compile from source and fails** — no prebuilt binary
matched your platform, and building needs a toolchain. On macOS:
`xcode-select --install`, then `npm rebuild better-sqlite3`. This is the only
native dependency in the project.

**`npm test` passes but the demo shows no citations** — that is a real failure,
not a flake. The demo exits non-zero. Send the output.

**Nothing writes to disk** — correct. Use `--persist` if you want a database
file at `./data/demo.db`.

---

## Where to look first

1. `SCHEMA.md` — the canon schema and directive spec. **This is the thing to
   sign off on**; the code follows from it.
2. `README.md` — architecture, the assumptions I made, and what still needs
   confirming.
3. `src/host/HostRuntime.ts` — the sovereignty seam, in about forty lines.
