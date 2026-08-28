/**
 * PIECES, in a browser. Three screens, one file, no build step.
 *
 * The product is one feeling: you come back and find the thing you made has
 * been changed by somebody else, with your name still on it. The return screen
 * (`?fan=`) is where that lands; the rest of this file exists to get you there
 * and to let you answer back.
 *
 * Shapes come from src/pieces/contract.ts, which is frozen. The two constants
 * below are copied from it because a browser cannot import TypeScript -- if the
 * contract ever unfreezes, they change here too.
 */

const BODY_MIN = 8;
const BODY_MAX = 1200;

const qs = new URLSearchParams(location.search);
const MOCK = qs.has("mock");

// --- tiny DOM helper --------------------------------------------------------

/**
 * Everything user-authored goes in through `text`, never innerHTML. Bodies are
 * arbitrary prose from strangers; there is no sanitiser in this file because
 * there is nothing to sanitise.
 */
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== "") n.append(kid);
  return n;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** Short, and unambiguous about the year without shouting it. */
function when(ts) {
  const d = new Date(ts);
  if (Number.isNaN(+d)) return el("span", { text: ts });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const text = d.toLocaleDateString(undefined, {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return el("time", { datetime: ts, text });
}

/** Links keep you in the same mode you arrived in (mock, key, identity). */
function href(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  if (MOCK) p.set("mock", "1");
  const s = p.toString();
  return s ? `?${s}` : "./";
}

// --- who you are ------------------------------------------------------------

/**
 * Identity is asserted, not authenticated -- the contract says so ("a durable
 * visitor id -- asserted, not authenticated"). `?fan=` wins, otherwise whatever
 * you last told the extend form.
 */
const me = {
  get id() { return qs.get("fan") || localStorage.getItem("pieces.fan") || ""; },
  get name() { return localStorage.getItem("pieces.name") || ""; },
  set(name) {
    const id = slug(name) || this.id;
    localStorage.setItem("pieces.fan", id);
    localStorage.setItem("pieces.name", name);
    return id;
  },
};

// ponytail: dev affordance. Writes need X-Inspiral-Key and a static page has
// nowhere else to get one; `?key=` stashes it so you only paste it once.
if (qs.get("key")) localStorage.setItem("pieces.key", qs.get("key"));
const KEY = localStorage.getItem("pieces.key") || "";

// --- the API ----------------------------------------------------------------

async function api(path, init) {
  if (MOCK) return mockApi(path, init);
  const headers = {};
  if (init?.body) headers["content-type"] = "application/json";
  if (KEY) headers["X-Inspiral-Key"] = KEY;
  const r = await fetch(path, { ...init, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// --- screens ----------------------------------------------------------------

const root = document.getElementById("app");

function render(...nodes) {
  root.replaceChildren(...nodes.filter(Boolean));
}

function chrome(right) {
  return el("nav", { class: "top" },
    el("a", { href: href({}), text: "Pieces" }),
    right,
  );
}

function fail(e) {
  render(chrome(), el("p", { class: "error", text: e.message }));
}

/** Survives the one re-render after you post, then clears. */
let flash = null;

/**
 * 1. THE PIECE.
 *
 * The lineage is a tree with one root (the seed) and no special cases, so it
 * renders as a tree: one visible rule per nesting, running back to the entry
 * being built on. Every entry carries an extend affordance -- including old
 * ones and the brief itself. Building on an older branch is normal.
 */
async function piecePage(pieceId) {
  const data = await api(`/v1/pieces/${encodeURIComponent(pieceId)}`);
  const { piece, seed_event_id, extensions } = data;
  document.title = `${piece.title} — Pieces`;

  const kids = new Map();
  const known = new Set([seed_event_id, ...extensions.map((x) => x.event_id)]);
  for (const x of extensions) {
    // An extension whose parent we cannot see still happened. Hang it off the
    // seed rather than dropping somebody's work off the page.
    const parent = known.has(x.parent_event_id) ? x.parent_event_id : seed_event_id;
    kids.set(parent, [...(kids.get(parent) ?? []), x]);
  }

  const open = piece.status === "open";

  const entry = (id, parts) =>
    el("li", { class: `entry${parts.seed ? " seed" : ""}` },
      el("article", {},
        parts.label && el("p", { class: "label", text: parts.label }),
        el("p", { class: "body", text: parts.body }),
        parts.who && el("p", { class: "meta" },
          el("span", { class: "who", text: parts.who }),
          when(parts.ts),
        ),
        open && extendButton(piece.piece_id, id),
      ),
      branch(id),
    );

  function branch(parentId) {
    const list = kids.get(parentId);
    if (!list) return null;
    return el("ol", { class: "branch" },
      // display_name, not the id: this page is the public artefact, and a
      // stranger reading it should see a person rather than a database key.
      list.map((x) => entry(x.event_id, { body: x.body, who: x.display_name || x.fan_id, ts: x.ts })),
    );
  }

  render(
    chrome(me.id && el("a", { href: href({ fan: me.id }), text: "What changed" })),
    el("h1", { text: piece.title }),
    el("p", { class: "status", text: open ? "Open — anything here can be built on" : "Closed — finished, still cited" }),
    flash && el("p", { class: "posted", role: "status", text: flash }),
    el("ol", { class: "lineage" },
      entry(seed_event_id, { seed: true, label: "The brief", body: piece.brief }),
    ),
  );
}

/** One open form at a time: opening another closes the first. */
function extendButton(pieceId, parentEventId) {
  const btn = el("button", {
    type: "button",
    "aria-expanded": "false",
    text: "Extend this",
    onclick: () => {
      const existing = document.querySelector("form.extend");
      const wasMine = existing?.dataset.parent === parentEventId;
      for (const b of document.querySelectorAll('button[aria-expanded="true"]')) {
        b.setAttribute("aria-expanded", "false");
        b.textContent = "Extend this";
      }
      existing?.remove();
      if (wasMine) return;
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "Never mind";
      const form = extendForm(pieceId, parentEventId);
      btn.after(form);
      form.querySelector("textarea").focus();
    },
  });
  return btn;
}

function extendForm(pieceId, parentEventId) {
  const uid = `x${Math.random().toString(36).slice(2, 8)}`;
  const nameInput = el("input", {
    id: `${uid}-name`, type: "text", value: me.name || me.id, autocomplete: "nickname",
    required: true, maxlength: 60,
  });
  const area = el("textarea", {
    id: `${uid}-body`, required: true, maxlength: BODY_MAX, spellcheck: "true",
  });
  const count = el("output", { class: "count", for: `${uid}-body` });
  const go = el("button", { type: "submit", class: "go", text: "Build on this", disabled: true });
  const status = el("p", { class: "posted", hidden: true, role: "status" });

  const tally = () => {
    const n = area.value.trim().length;
    const short = n < BODY_MIN;
    count.textContent = short
      ? `${BODY_MIN - n} more character${BODY_MIN - n === 1 ? "" : "s"} before this can be posted`
      : `${BODY_MAX - n} of ${BODY_MAX} left`;
    count.classList.toggle("short", short);
    go.disabled = short;
  };
  area.addEventListener("input", tally);
  tally();

  const form = el("form", {
    class: "extend", "data-parent": parentEventId, novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      // Attribution IS the product; an extension with nobody's name on it is
      // worse than no extension. A dead submit button would not explain that.
      const name = nameInput.value.trim();
      if (!name) {
        status.textContent = "Your name goes on this. Say who you are first.";
        status.hidden = false;
        nameInput.focus();
        return;
      }
      go.disabled = true;
      try {
        const fan_id = me.set(name);
        const res = await api(`/v1/pieces/${encodeURIComponent(pieceId)}/extend`, {
          method: "POST",
          body: JSON.stringify({
            fan_id, parent_event_id: parentEventId, body: area.value.trim(),
            display_name: name,
          }),
        });
        // Honest about the audience: `notifies` is null when you built on the
        // brief, and saying "someone will see this" would be a small lie.
        flash = res.notifies
          ? `Posted. ${res.notifies} will find this sitting on top of their work.`
          : "Posted. You built on the brief, so this notifies nobody.";
        status.textContent = flash;
        status.hidden = false;
        area.value = "";
        tally();
        await piecePage(pieceId);
        flash = null;
      } catch (e) {
        status.textContent = e.message;
        status.hidden = false;
        go.disabled = false;
      }
    },
  },
    el("label", { for: `${uid}-name`, text: "You are" }), nameInput,
    el("label", { for: `${uid}-body`, text: "Change it. Say what you changed and what for.", style: "margin-top:.7rem" }), area,
    el("div", { class: "row" }, count, go),
    status,
  );
  return form;
}

/**
 * 2. THE RETURN SCREEN. The one that matters.
 *
 * Order is fixed and deliberate: your thing as you left it, what they did to
 * it, who they are, then the sentence. You should recognise your own work
 * before you are told anything about it.
 *
 * Empty is a real answer. No counter, no "3 people are talking about you", no
 * nudge to come back tomorrow.
 */
async function returnPage(fanId) {
  const data = await api(`/v1/waiting?fan=${encodeURIComponent(fanId)}`);
  const items = data.items ?? [];
  document.title = "What changed — Pieces";

  if (!items.length) {
    render(
      chrome(),
      el("section", { class: "return" },
        el("h1", { text: "Nothing has changed." }),
        el("div", { class: "empty" },
          el("p", { text: "Nobody has built on your work since you were last here." }),
          el("p", { text: "There is nothing else to tell you. When somebody does, it will be on this page." }),
        ),
        el("p", { style: "margin-top:2rem" }, el("a", { href: href({}), text: "Find a piece to add to" })),
      ),
    );
    return;
  }

  render(
    chrome(),
    el("section", { class: "return" },
      el("h1", { text: "Somebody built on your work." }),
      items.map((it) =>
        el("article", { class: "item" },
          el("h2", {}, "In ", el("a", { href: href({ piece: it.piece_id }), text: it.piece_title })),

          // a. yours, as you left it
          el("div", { class: "yours" },
            el("p", { class: "label", text: "You left this" }),
            el("p", { class: "body", text: it.your_body }),
          ),

          // b. what they did
          el("div", { class: "theirs" },
            el("p", { class: "label", text: "They changed it to this" }),
            el("p", { class: "body", text: it.their_body }),
          ),

          // c. who they are
          el("p", { class: "who-big", text: it.their_display_name || it.their_fan_id }),
          el("p", { class: "who-verb", text: "changed it" }),

          // d. the sentence
          it.changed && el("p", { class: "changed", text: it.changed }),

          el("p", { class: "when" },
            when(it.ts), " · ",
            el("a", { href: it.permalink, text: "receipt" }), " · ",
            el("a", { href: href({ piece: it.piece_id }), text: "answer back" }),
          ),
        ),
      ),
    ),
  );
}

/** 3. THE INDEX. Titles and briefs. Nothing to rank, nothing to compare. */
async function indexPage() {
  const data = await api("/v1/pieces");
  const pieces = Array.isArray(data) ? data : (data.pieces ?? []);
  document.title = "Pieces";
  render(
    chrome(me.id && el("a", { href: href({ fan: me.id }), text: "What changed" })),
    el("h1", { text: "Open pieces" }),
    el("p", { class: "status", text: "Take what somebody left and change it. Your name stays on what you wrote." }),
    pieces.length
      ? el("ul", { class: "pieces" }, pieces.map((p) =>
          el("li", {},
            el("h2", {}, el("a", { href: href({ piece: p.piece_id }), text: p.title })),
            el("p", { text: p.brief }),
          )))
      : el("p", { class: "note", text: "No open pieces right now." }),
  );
}

// ============================================================================
// MOCK. `?mock=1` serves everything below instead of the network, so the three
// screens are runnable and reviewable with no server. It is a real little
// store: an extension you post shows up in the lineage AND on the return
// screen of whoever you built on.
//
// One deliberate difference from production: the mock returns no `changed`
// sentence for anything you post, because the Mind writes that and there is no
// Mind here. That is also the degraded path the contract requires the UI to
// survive ("losing the narration must never lose the work") -- so posting in
// the mock is how you check it does.
// ============================================================================

const FIXTURE = {
  names: {
    wren: "Wren", maya: "Maya Oduya", ash: "Ash Vinter",
    juno: "Juno Bell", pell: "Pell", rook: "Rook",
  },
  pieces: [
    {
      piece_id: "one_sauce", title: "One Sauce, Many Hands",
      brief: "A sauce, passed hand to hand. Take what is above you, change exactly one thing, and say what you changed it for. Do not start over, and do not be polite about it.",
      status: "open", generation: 5, contributors: ["wren", "maya", "ash", "juno", "pell"],
      seed_event_id: "ev_seed_sauce",
      created_ts: "2026-08-20T10:00:00Z", updated_ts: "2026-08-26T22:40:00Z",
    },
    {
      piece_id: "six_words_door", title: "Six Words About a Door",
      brief: "Six words. A door. It cannot be a metaphor for anything and it must still hurt. Take somebody's six and write six back.",
      status: "open", generation: 3, contributors: ["rook", "wren"],
      seed_event_id: "ev_seed_door",
      created_ts: "2026-08-22T08:00:00Z", updated_ts: "2026-08-27T11:20:00Z",
    },
  ],
  extensions: [
    {
      event_id: "ev_1", piece_id: "one_sauce", parent_event_id: "ev_seed_sauce", fan_id: "wren",
      body: "Two shallots sweated in butter until they go translucent and no further. Half a bottle of dry white, reduced until the pan is almost dry. A ladle of veal stock, reduced again by half. That is the base. It is brown, it is quiet, and it will carry anything you put on it.",
      ts: "2026-08-21T09:12:00Z",
    },
    {
      event_id: "ev_2", piece_id: "one_sauce", parent_event_id: "ev_1", fan_id: "maya",
      body: "Kept your base and stopped at the second reduction. Then a spoon of sherry vinegar off the heat, and the whole thing sits up straight. Reducing alone makes it sweet and heavy. The acid gives it a spine to hang the fat on. If it tastes sharp now, good — it will not later.",
      changed: "Maya didn't agree with your reduction. She cut it with acid instead, and kept your base.",
      ts: "2026-08-23T18:40:00Z",
    },
    {
      event_id: "ev_3", piece_id: "one_sauce", parent_event_id: "ev_1", fan_id: "ash",
      body: "Left your base exactly as written. Changed the finish: pan off the heat, then cold butter, cube by cube, swirled and not whisked. Whisking heat back into it is why it splits. Same sauce. It just stops breaking on the way to the table.",
      changed: "Ash left your reduction alone and went after the finish instead — cold butter, off the heat, so it stops splitting.",
      ts: "2026-08-25T07:05:00Z",
    },
    {
      event_id: "ev_4", piece_id: "one_sauce", parent_event_id: "ev_2", fan_id: "juno",
      body: "Building on the vinegar. Swapped it for the liquor from a jar of pickled walnuts — same acid, but it brings tannin and something like soy with it. The sauce goes almost black. Serve it with anything that was recently on a fire.",
      changed: "Juno took your vinegar further than you did — pickled walnut liquor, for the tannin.",
      ts: "2026-08-26T21:15:00Z",
    },
    {
      event_id: "ev_5", piece_id: "one_sauce", parent_event_id: "ev_seed_sauce", fan_id: "pell",
      body: "Ignoring the pan entirely. Roast the shallots whole in their skins until they collapse, then push them through a sieve into hot stock. No wine at all. You get the same depth without twenty minutes of standing over it, and it is the only version I have made twice on a weeknight.",
      ts: "2026-08-26T22:40:00Z",
    },
    {
      event_id: "ev_6", piece_id: "six_words_door", parent_event_id: "ev_seed_door", fan_id: "rook",
      body: "Painted shut. Nobody minded. Nobody asked.",
      ts: "2026-08-24T19:00:00Z",
    },
    {
      event_id: "ev_7", piece_id: "six_words_door", parent_event_id: "ev_6", fan_id: "wren",
      body: "They painted it shut from outside.",
      changed: "Wren kept your six words and moved the hand doing the painting to the other side of the door.",
      ts: "2026-08-25T20:30:00Z",
    },
    {
      event_id: "ev_8", piece_id: "six_words_door", parent_event_id: "ev_7", fan_id: "rook",
      body: "Six back: I was still inside.",
      changed: "Rook answered your six words with six of his own, and put himself on the wrong side of the door.",
      ts: "2026-08-27T11:20:00Z",
    },
  ],
};

/**
 * Kept in sessionStorage so what you post survives the walk from the piece page
 * to somebody's return screen -- which is the only way to see the whole loop
 * without a server. `?mock=reset` puts the fixtures back.
 */
if (qs.get("mock") === "reset") sessionStorage.removeItem("pieces.mock");
const DB = JSON.parse(sessionStorage.getItem("pieces.mock") || "null") ?? FIXTURE;
const saveDB = () => sessionStorage.setItem("pieces.mock", JSON.stringify(DB));

async function mockApi(path, init) {
  const url = new URL(path, location.origin);
  const parts = url.pathname.split("/").filter(Boolean);

  if (init?.method === "POST") {
    const body = JSON.parse(init.body);
    const piece = DB.pieces.find((p) => p.piece_id === parts[2]);
    if (!piece) throw new Error(`no piece '${parts[2]}'`);
    if (body.body.length < BODY_MIN) throw new Error("too short");
    if (body.body.length > BODY_MAX) throw new Error("too long");
    const parent = DB.extensions.find((x) => x.event_id === body.parent_event_id);
    if (!parent && body.parent_event_id !== piece.seed_event_id) throw new Error("nothing to build on");
    const ext = {
      event_id: `ev_${DB.extensions.length + 1}_m`, piece_id: piece.piece_id,
      parent_event_id: body.parent_event_id, fan_id: body.fan_id, body: body.body,
      ts: new Date().toISOString(),
    };
    DB.extensions.push(ext);
    if (body.display_name) DB.names[body.fan_id] = body.display_name;
    if (!piece.contributors.includes(body.fan_id)) piece.contributors.push(body.fan_id);
    piece.generation += 1;
    piece.updated_ts = ext.ts;
    saveDB();
    const notifies = parent && parent.fan_id !== body.fan_id ? parent.fan_id : null;
    return {
      event_id: ext.event_id, piece_id: piece.piece_id, generation: piece.generation,
      permalink: `/w/pieces/e/${ext.event_id}`, notifies,
    };
  }

  if (parts[1] === "waiting") {
    const fan = url.searchParams.get("fan");
    const mine = new Set(DB.extensions.filter((x) => x.fan_id === fan).map((x) => x.event_id));
    const items = DB.extensions
      .filter((x) => x.fan_id !== fan && mine.has(x.parent_event_id))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .map((x) => ({
        piece_id: x.piece_id,
        piece_title: DB.pieces.find((p) => p.piece_id === x.piece_id).title,
        your_event_id: x.parent_event_id,
        your_body: DB.extensions.find((e) => e.event_id === x.parent_event_id).body,
        their_event_id: x.event_id, their_fan_id: x.fan_id,
        their_display_name: DB.names[x.fan_id] || x.fan_id,
        their_body: x.body,
        ...(x.changed ? { changed: x.changed } : {}),
        ts: x.ts, permalink: `/w/pieces/e/${x.event_id}`,
      }));
    return { fan_id: fan, items };
  }

  if (parts[1] === "pieces" && parts[2]) {
    const piece = DB.pieces.find((p) => p.piece_id === parts[2]);
    if (!piece) throw new Error(`no piece '${parts[2]}'`);
    const { seed_event_id, ...rest } = piece;
    return {
      piece: rest, seed_event_id,
      extensions: DB.extensions
        .filter((x) => x.piece_id === piece.piece_id)
        .sort((a, b) => a.ts.localeCompare(b.ts)),
    };
  }

  return DB.pieces.map(({ seed_event_id, ...p }) => p).filter((p) => p.status === "open");
}

// --- route ------------------------------------------------------------------
// Last, so the mock store above is initialised before the first screen asks
// for it.

const pieceParam = qs.get("piece");
const fanParam = qs.get("fan");
(pieceParam ? piecePage(pieceParam) : fanParam ? returnPage(fanParam) : indexPage()).catch(fail);
