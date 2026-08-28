# Setup

```bash
git clone https://github.com/FlyingWHR/inspiral && cd inspiral
npm install
npm test                                    # the suite, offline, no key
INSPIRAL_API_KEY=dev npm run pieces:serve   # http://localhost:8795
```

That is the whole product: app, API, live feed and public pages on one port.
Node 22 or newer (`node -v`) — the Minds client library requires it. macOS or
Linux.

## Seeing the thing it is actually for

Without a key you get the degraded path — stored and attributed, no sentence
(see [SUBMISSION.md](SUBMISSION.md) section 2). With one:

```bash
cp .env.example .env          # then put a Builder API key in it
INSPIRAL_HOST=minds npm run pieces      # the sentence, next to the two texts
```

`.env` is gitignored. Every entry point loads it via
`node --env-file-if-exists=.env`, and shell variables win over the file.
`.env.example` documents every variable the code reads, including the
notification channels and the SSRF guard on webhooks.

If `INSPIRAL_HOST=minds` but no key is present, the process warns and falls back
to the mock rather than failing.

---

## The older world

Everything below sets up the FIRST product — the autonomous world that did not
work. It is kept because the measurements that killed it are still runnable
(`npm run clock:status`, `npm run problem`). See SUBMISSION.md section 3.

### From a zip instead of a clone

Safe to run more than once; it will not re-unzip over a folder that already has
a `package.json`, and it deletes nothing.

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

Already unzipped somewhere else? `cd` into the folder containing `package.json`:

```bash
npm install --no-audit --no-fund && npm test && npm run demo
```

### What you should see

Six days of world history scrolling past, then **THE RETURN VISIT** where an NPC
greets the visitor as an ally and complains about something a rival did while
they were away — followed by **VERIFICATION**, which looks up every cited event
id in the append-only log and prints the day it actually happened.

`OK` lines mean the whole loop works: canon → digest → host → validation →
deltas → rendered behaviour → grounded callback. The demo exits non-zero if a
citation cannot be resolved, so it is usable as a smoke test.

### Useful commands

```bash
npm run demo                    # six days, in memory, nothing written to disk
npm run demo -- --verbose       # every line of dialogue, every tick
npm run demo -- --days 10       # ten days
npm run demo -- --seed 7        # a different history; same seed = same run
npm run demo -- --persist       # write to ./data/demo.db instead of memory
npm run demo -- --persist --reset   # ...starting from scratch

npm run typecheck

npm run tick                    # one tick against the persistent db
npm run tick -- --watch         # scheduler, every 4h
npm run canon                   # inspect canon state
npm run canon -- --digest       # the exact briefing the host would receive
npm run canon -- --events 40
```

`npm run demo` is in-memory by default, so it never leaves a database behind.
Use `--persist` for a file at `./data/demo.db`.

To run the world against a real Mind, set `INSPIRAL_HOST=minds` and
`MINDS_BUILDER_API_KEY=<key from build.hellominds.ai/console>` in `.env`
(optionally `INSPIRAL_MIND_ID`; otherwise the first funded Mind on the account),
then `npm run tick`.

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

## Where to look first

1. `SCHEMA.md` — the canon schema and directive spec. **This is the thing to
   sign off on**; the code follows from it.
2. `README.md` — architecture, the assumptions I made, and what still needs
   confirming.
3. `src/host/HostRuntime.ts` — the sovereignty seam, in about forty lines.
