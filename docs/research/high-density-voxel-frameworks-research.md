# High-Density Voxel Frameworks & Engines — Landscape Survey

**Compiled 2026-08-18.** All dates, licenses and repo facts below were read from primary sources (GitHub repo pages, ungh.cc/crates.io APIs, official docs, engine source) during this research session. Anything not confirmed is marked ⚠️ **UNVERIFIED**.

**Scope note.** This document answers two different questions, in order:

1. **The survey you asked for first** — the open-source / openly-documented high-density voxel landscape (§1–§8).
2. **The question your brief v0.1 actually poses** — which engine lets an external Node server drive NPC entities and dialogue fastest and most reliably, given that `[ENGINE — TBD]` sits behind an adapter and physics/destruction/terrain-editing are *not* requirements (§9–§12).

These two questions have almost entirely disjoint answers. The best high-density voxel renderers are the worst choices for your hackathon, and vice versa. That is the single most important finding here.

---

## §0. "Blipp" — resolved

**You almost certainly mean [Blip](https://github.com/bliporg/blip) (one `p`), formerly known as Cubzh.** `github.com/cubzh/cubzh` now redirects to `github.com/bliporg/blip`. No project named "Blipp" or "Bliip" exists in this space as far as I can determine — nothing in search, GitHub, or the voxel community turns up either spelling. I am confident in the identification but flagging it so you can correct me.

### What Blip is

| Field | Finding |
|---|---|
| Repo | https://github.com/bliporg/blip — 281★, 29 forks, **3,027 commits** |
| License | **Apache-2.0** ✅ |
| What it is | A Roblox-like UGC game platform "tailored for generative AI." Not a research renderer — a shipped commercial product whose full source went public |
| Language / API | C/C++ core on **BGFX**; Go is actually the largest language at 59.8% (backend services); **Luau** scripting; WebAssembly for browser & Discord |
| Platforms | iOS/iPadOS, Android, Windows, macOS, browsers, Discord |
| **Voxel density** | ⚠️ **Not high-density.** It is Roblox/MagicaVoxel-scale — blocky cubes for terrain, small-voxel models for characters and props. If you named it expecting Teardown-class micro-voxels, it is not that |
| Multiplayer | **Yes, genuinely** — client *and* server Luau, with hosted "free scalable server infrastructure" |
| Physics | Basic collision (`Object.OnCollisionBegin`), no destruction sim |
| Repo status | README banner: *"Resources from the private repository have been recently imported. The build is not yet functional and instructions will be provided once integration is complete."* |
| Last push | 2026-03-09 |

### Why Blip matters — and why it's a trap

Blip is the **only fully open-sourced, commercially-shipped, multiplayer voxel platform with server-side scripting and an LLM API built in.** On paper it is an uncannily good match for your brief. Verified from the engine source (`lua_sandbox.cpp`, `lua_http.cpp`), it has:

- `HTTP:Get/Post/Patch/Delete(url, headers, body, callback)` available in **both** client and server sandboxes, with **no egress allowlist** — server Luau can call any HTTPS endpoint
- `Server.OnStart` / `Server.Tick(dt)` / `Server.OnPlayerJoin` / `DidReceiveEvent`
- `Event()` with `:SendTo(Players)` for server→client pushes
- `avatar:get{}` NPC avatars with built-in Walk/Idle animations, `pf_astar` pathfinding, `textbubbles.set(object, text, duration)` speech bubbles
- A first-party LLM API: `AI:CreateChat(systemPrompt)` / `chat:Say(msg, cb)`

**The problem is that the project appears abandoned.** Steam (appid 1386770) last updated **2025-05-16** — over 15 months ago. Mobile builds last shipped **2025-08-06**. The web build at `app.cu.bzh` hangs on a stale "Cubzh — Loading..." splash and never renders. The open-source build is admittedly non-functional. And GitHub issue [#945, "Is the development stopped?"](https://github.com/bliporg/blip/issues/945), has sat unanswered since **2026-01-08**.

The backend is Apache-2.0 and in the repo (gameserver, hub, ScyllaDB, Mongo, nginx), so self-hosting is theoretically possible — but container images live in a private registry and the build doesn't work. That's weeks, not days.

**Verdict: study its API design, don't build on it.** It is not too early; it's too late.

⚠️ **UNVERIFIED:** the exact date Cubzh relicensed to Apache-2.0 and imported the private repo. This is the least-nailed-down fact in this document. If Blip's status matters to your decision, ask in their Discord before anything else.

---

## §1. The density spectrum — orienting yourself

Voxel "density" is the axis everything else hangs off, and the terminology is used loosely. Concretely:

| Tier | Voxel edge | Examples | What it costs you |
|---|---|---|---|
| **Block-scale** | ~1 m | Minecraft, Luanti (1×1×1 nodes), Veloren terrain, Blip, Cubyz, VoxelCore | Cheap. Mesh it, ship it. Multiplayer is solved |
| **Model-scale** | 5–20 cm | MagicaVoxel props, Veloren *characters*, Teardown | Needs raymarching or heavy meshing |
| **Micro-voxel** | ≤1 cm | Cubiquity, SVDAG research, Atomontage's "Virtual Matter" | Needs compression (DAG/brickmap). Nobody has shipped this with multiplayer |

**Teardown sits at 10 cm** — and that is the *shipped commercial ceiling* for interactive destructible voxels, not a floor. Anything below ~5 cm with physics and networking exists only in papers and demos.

---

## §2. Teardown — closed, but the best-documented voxel engine alive

The engine has **never been open-sourced** and there's no indication it will be. What's public is unusually rich.

### Verified technical facts (Teardown 1.x, shipped)

- **Voxel size: 10 cm (0.1 m).** Corroborated by the [Teardown Wiki](https://teardown.fandom.com/wiki/Voxels), by modding convention (Lua moves objects 0.1 per voxel), and by arithmetic against two independent RenderDoc captures (Marina at 3504×200×3000 voxels ⇒ ~350×20×300 m — exactly right). ⚠️ Not stated in official Tuxedo Labs docs. Don't confuse with the 2018 *prototype*, which used a 5 cm shadow texture.
- **OpenGL 3.3. No compute shaders, no hardware ray tracing.** Almost everything is in fragment shaders.
- **Zero triangles for voxel geometry.** Each object is a 3D volume texture, one byte per voxel indexing a 256-entry palette (colour + roughness + metallic + emissive + physical material). Rendering draws the object's oriented bounding box (36 verts, backfaces only) and **raymarches the volume in the fragment shader** via modified voxel DDA (Amanatides & Woo), writing `gl_FragDepth`.
- **Acceleration:** per-object, 2 extra MIP levels acting as a dense octree (hence all dimensions must be multiples of 4). Globally, a **"shadow volume"** — 1 bit per voxel across the whole level, 2×2×2 voxels packed per byte, ~200–260 MB, **rasterized on the CPU** and uploaded incrementally with `glTexSubImage3D`. This is why reflections of moving objects visibly lag and snap to a grid.
- **No global illumination.** Gustafsson, explicitly: *"Teardown actually doesn't implement global illumination… but we use raytracing for ambient occlusion, soft shadows and specular occlusion."*
- **Physics on voxels directly.** Collision detection was rewritten to work on voxel volumes rather than meshes — SIMD + multithreaded. Breakage triggers connectivity analysis; disconnected regions become new independent objects, recursively, inheriting the parent palette.
- **Max 256³ voxels per object** (official modding limit; 128³ recommended).

### Multiplayer (shipped 2026-03-12) — the most relevant part for you

His [March 2026 post](https://blog.voxagon.se/2026/03/13/teardown-multiplayer.html) is the single best public document on networking a voxel world. Key design:

- **Host-is-server, hybrid semi-deterministic.** No dedicated servers.
- **Destruction replicates as a deterministic command stream on a reliable ordered channel** — never as voxel data. Commands like *"cut hole in this shape at voxel x,y,z."* Cost independent of object size. Destruction logic was rewritten in **fixed-point integer math**.
- **Everything else is unreliable state sync with eventual consistency**, driven by a per-client priority queue favouring visible objects within a **~1 Mbit/client budget**.
- **Join-in-progress replays the recorded command stream**, with a capped buffer; JIP disables once it fills.
- **Terminal UI runs server-side and streams delta-compressed draw commands to clients** — explicitly modelled on X11, not video encoding. Worth reading if you're thinking about server-authoritative NPC dialogue.
- His own verdict: *"The multiplayer implementation in Teardown isn't particularly elegant; it's just a lot of hard work and a lot of code."*

### The new engine (unannounced game, not "Teardown 2")

Vulkan + **hardware ray tracing via intersection shaders — still no triangles**. The shadow volume is gone, removing the world-size cap and enabling true reflections and real GI. Sparse format: shapes split into 8×8×8 chunks tracked by a 3D bitmap. Deformable voxels (raytracing inside a skewed cuboid). Physics moved to substepping (Temporal Gauss-Seidel) rather than solver iteration. Denoising via DLSS Ray Reconstruction.

### Essential reading

| Resource | URL |
|---|---|
| GPC 2025 slides, "Raytracing Voxels in Teardown and Beyond" (Rundlett + Gustafsson) | [PDF, 119 MB](https://static.graphicsprogrammingconference.com/public/2025/slides/raytracing-voxels-in-teardown/Rundlett-Gustafsson-raytracing-voxels-in-teardown-and-beyond.pdf) |
| "From screen space to voxel space" (2018) — the foundational post | https://blog.voxagon.se/2018/10/17/from-screen-space-to-voxel-space.html |
| "The unlikely story of Teardown Multiplayer" (2026-03-13) | https://blog.voxagon.se/2026/03/13/teardown-multiplayer.html |
| Year summary 2024 — the new engine | https://blog.voxagon.se/2024/12/29/year-summary.html |
| **Teardown Frame Teardown** — Steven Wittens, RenderDoc breakdown | https://acko.net/blog/teardown-frame-teardown/ |
| **Teardown Teardown** — Juan Diego Montoya, RenderDoc breakdown | https://juandiegomontoya.github.io/teardown_breakdown.html |
| 80.lv interview (2026-03-17) | https://80.lv/articles/teardown-developer-breaks-down-multiplayer-and-voxel-destruction-tech |

**Note:** Gabe Rundlett — whose open-source GVOX engine appears below — is now Lead Rendering Engineer at Tuxedo Labs. The commercial answer to voxel destruction is his day job; the OSS is nights and weekends. That explains a lot about the state of the open ecosystem.

---

## §3. Douglas Dwyer / Octo — the most Teardown-shaped thing outside Teardown, and you can't have it

| Field | Finding |
|---|---|
| Repos | [octo-release](https://github.com/DouglasDwyer/octo-release) (396★) · [voxel_engine](https://github.com/DouglasDwyer/voxel_engine) (modding API, 6★) |
| **Source available?** | **NO.** Verified file listing of octo-release: `README.md`, `index.html`, `octo.exe` (27 MB), `web-*.js`, `web-*_bg.wasm` (20 MB). It is a **binary distribution repo** |
| License | **No LICENSE file on octo-release** ⇒ all rights reserved. The `voxel_engine` modding crate is MIT OR Apache-2.0 |
| Stack | **Rust + WGPU/WebGPU + WASM**; native (Windows) and browser |
| Rendering | Voxel **ray marching in compute shaders**, LODs, real-time **path-traced GI** |
| Density | High-density by design (ray-marched volumes, not block meshes). ⚠️ **Exact voxel edge length UNVERIFIED** — no published figure found |
| Multiplayer | **TCP networked multiplayer, desktop only.** P2P (web + desktop) existed previously, removed in the ray-marching rewrite, "to be re-added" |
| Physics | **Yes** — rigidbody sim, connected-component detection, collision response, destruction + building |
| Modding | WASM plugin system (`wings`), egui, input APIs |
| Last activity | octo-release pushed **2026-07-31** ✅; the modding API repo is stale at **2024-08-29** ✅ |

**Octo is the only project in this survey that combines high-density voxels + rigid-body physics + destruction + working multiplayer.** It is also closed. Play the [web demo](https://douglasdwyer.github.io/octo-release/) — it takes minutes and is the fastest way to calibrate what "high-density voxel with physics" actually feels like.

⚠️ Search summaries claim development moved to Patreon and the repo is frozen at Aug 2024. **Neither checks out** — the repo was pushed 2026-07-31 and the README has no Patreon reference. Treat "Patreon-gated" as unconfirmed. The practical conclusion is unchanged: you cannot get the engine source.

---

## §4. SVO / brickmap / voxel-DAG renderers

This is where the genuinely high-density work lives. It is also, uniformly, **rendering research with no networking and no physics.**

### The main table

| Project | License | Lang / API | Structure | Density | Last activity | ★ | Days to render |
|---|---|---|---|---|---|---|---|
| [GVOX Engine](https://github.com/GabeRundlett/gvox_engine) | MIT | C++/GLSL, Vulkan via Daxa | Hierarchical LOD DDA, uniformity bitmask over 64³ chunks + 8³ palette | **6.25 cm** (16 vox/m), 2048³ resident ⇒ 128 m/axis | 2026-08-17 (`rewrite` branch) | 427 | **Weeks** — doesn't build clean |
| [Daxa](https://github.com/Ipotrick/Daxa) | MIT | C++, Vulkan bindless | *Not a renderer* — GPU abstraction + TaskGraph | n/a | 2026-08-15 | 609 | 1–2 |
| [Cubiquity](https://github.com/DavidWilliams81/cubiquity) | **CC0** | C++ zero-dep + OpenGL/SDL2 | **SVDAG**, ESVO raycast, CPU path tracer | Sub-cm; Quake E1M1 "fits on a floppy" (~1.44 MB) | **2026-07-17** | 285 | ~1 |
| [VoxelRT](https://github.com/dubiousconst282/VoxelRT) | MIT | C++, OpenGL 4.6 compute + CPU SIMD | **Tree64** + brickmap + ESVO variants, GI, denoiser | ~500M voxels, 4K³ scenes | 2025-10-20 | 143 | 2–3 |
| [SparseVoxelOctree](https://github.com/AdamYuan/SparseVoxelOctree) | MIT | C++, Vulkan | GPU SVO builder + raymarcher + path tracer | 1K³–4K³ | 2025-11-08 | 682 | ~1 |
| [HashDAG](https://github.com/Phyronnaz/HashDAG) | MIT | C++/CUDA | Editable SVDAG (Careil et al., EG 2020) | **128K³** (Epic Citadel), ≥8 GB VRAM | 2024-01-03 | 158 | 2–4 |
| [GPU-SVDAG-Editing](https://github.com/mathijs727/GPU-SVDAG-Editing) | MIT | C++/CUDA | GPU-side SVDAG editing (PG 2024) | **128K³** | 2024-11-15 | 7 | 2–4 |
| [BrickMap](https://github.com/stijnherfst/BrickMap) | MIT | C++/CUDA | Brickmap path tracer, index-based LoD | 8³ bricks, 3 LoDs | 2025-03-12 | 112 | Days (NVIDIA only) |
| [NanoVDB / OpenVDB](https://github.com/AcademySoftwareFoundation/openvdb) | **Apache-2.0** | C++/CUDA, Vulkan/DX12/OptiX | Pointerless GPU-linearized VDB | Unbounded sparse | **2026-08-18** | 3,369 | 1–2 |
| [voxpopuli](https://github.com/jbikker/voxpopuli) | CC0 | C++ SIMD + OpenGL | DDA over brick grids | Teaching template | 2026-01-27 | 73 | **Hours** |
| [jsoulier/voxel_raytracer](https://github.com/jsoulier/voxel_raytracer) | Unlicense | C, **SDL3 GPU** (VK/D3D12/**Metal**) | Hierarchical DDA in compute | Demo scale | 2026-08-15 | 22 | **Hours** |
| [DAGger](https://github.com/RvanderLaan/DAGger) | GPL-3.0 | TypeScript/WebGL | SVDAG path tracer | 32K³ **in a browser** | 2021-01-18 | 56 | **Zero — [live demo](https://rvanderlaan.github.io/DAGger/)** |

### What this table means

**Nothing here has networked multiplayer. Nothing here has rigid-body physics.** What exists is *editing* — brush carve/fill (VoxelRT, Cubiquity, HashDAG, GPU-SVDAG-Editing) — not simulation. Budget for building both yourself if you go this route, which is exactly why none of this belongs in a 10-day plan.

**Notable specifics:**

- **GVOX Engine** density comes from source constants, not marketing: `LOG2_VOXELS_PER_METER 4` ⇒ 16 voxels/m. But it had **zero commits in all of 2025** and only woke up two weeks ago; the README says *"nowhere near any usability"*; open issue [#21 "Does not compile"](https://github.com/GabeRundlett/gvox_engine/issues/21) is unanswered. Windows/Linux only.
- **VoxelRT is the most valuable artifact in this section** even if you never ship it. It implements and head-to-head benchmarks **nine** acceleration structures with Mrays/s and clocks/iter. Its data shows **Tree64 (4³ "contree") and XBrickMap beating ESVO by roughly 1.5–2×** — a real argument against reflexively starting from a classic SVO. Companion writeup: [A guide to fast voxel ray tracing using sparse 64-trees](https://dubiousconst282.github.io/2024/10/03/voxel-ray-tracing/).
- **NanoVDB is the boring correct answer** if you need production stability: best license, longest support horizon, updated today. Caveat: it's a volume/level-set structure without DAG subtree dedup, so no 128K³-Citadel-in-945 MB.
- **DAGger takes zero minutes** — open the link and see a 32K³ DAG path-traced in your browser right now.

### GigaVoxels — the research line is alive, the library is not

[gigavoxels.inria.fr](https://gigavoxels.inria.fr/) is still up and the BSD-3-Clause downloads still work, but the last package targets **Ubuntu 14.04 / VS2013 / CUDA 7** (~2015). INRIA states it "cannot ensure long term software maintenance." GitHub mirrors are stale (2017, 2020). The research continues — *"GigaVoxels DP,"* HPG 2024, [hal.science/hal-04654692v1](https://hal.science/hal-04654692v1) — with **no public code**.

### Academic lineage

- **ESVO** (Laine & Karras, I3D 2010): original NVIDIA release still downloadable, BSD-3-Clause, Windows+CUDA. Note ESVO is *not* a 128K³ technique — 11–13 level octrees (~2K³–8K³) plus per-voxel contours.
- **Voxel DAG** (Kämpe/Sintorn/Assarsson, SIGGRAPH 2013): Epic Citadel at **128K³ = 19 billion voxels in 945 MB**. No official code.
- ⚠️ **Correction to your brief:** the author is **Victor Careil** (`Phyronnaz`), not "Careaga." Same person who wrote Unreal's Voxel Plugin. Citation: Careil, Billeter, Eisemann, *Interactively Modifying Compressed Sparse Voxel Representations*, CGF 39(2), EG 2020.
- **The live front is TU Delft (Eisemann group), all MIT:** [eg2023-svdag-attribute-editing](https://github.com/mathijs727/eg2023-svdag-attribute-editing), [GPU-SVDAG-Editing](https://github.com/mathijs727/GPU-SVDAG-Editing), [i3d2025-voxel-transform-dag](https://github.com/mathijs727/i3d2025-voxel-transform-dag).
- **Aokana** (i3D 2025, [arXiv:2505.02017](https://arxiv.org/abs/2505.02017)) — SVDAG + LOD + streaming for open worlds, "tens of billions of voxels." The most relevant paper for a production engine, and **zero code**. ⚠️ The arXiv abstract claims 9× memory / 4.8× speedup; the camera-ready says one-third-to-one-tenth / 2–4×.
- **NAADF** (TU Wien, EG 2026) — [github.com/cg-tuwien/NAADF](https://github.com/cg-tuwien/NAADF) — nested axis-aligned distance fields, claims 3–5× faster than DAGs, worlds to 16384³, dynamic entities + editing. **Has code.** ⚠️ Perf claims unverified.

### "Voxel Bertie"

⚠️ **No evidence this exists.** Zero hits across repos, videos, blogs and search. Likely a misremembered name — the nearest real things are Gabe Rundlett's `gvox_engine` and `gvox`.

---

## §5. Rust voxel ecosystem

**Headline: there is no maintained, permissively-licensed, batteries-included high-density Rust voxel engine.** Nothing combines cm-scale voxels + raytracing + physics + multiplayer + permissive license + active maintenance. Every candidate fails at least two.

| Project | License | Last push | ★ | Density | Physics | MP | Notes |
|---|---|---|---|---|---|---|---|
| [dust](https://github.com/dust-engine/dust) | MPL-2.0 | 2026-08-11 | 128 | High (VDB-style) | ✗ | ✗ | Vulkan **hardware RT**, DLSS-RR, Bevy. Needs nightly + **Bazel** + patched Bevy fork + patched `ash`. Not a drop-in |
| [VoxelHex](https://github.com/Ministry-of-Voxel-Affairs/VoxelHex) | MIT + Apache-2.0 | 2025-10-26 | 55 | High — sparse voxel-brick tree, **WGPU/WGSL raytracing** | ✗ | ✗ | Best-licensed high-density WGPU option, but ~10 months quiet |
| [roxlap](https://github.com/NCrashed/roxlap) | MIT/Apache-2.0 | 2026-08-08 | **5** | High — brickmap, per-pixel 3D-DDA | Carving | ✗ | Voxlap reimplementation. Most practical permissive starting point, but 4 months old |
| [voxelis](https://github.com/WildPixelGames/voxelis) | MIT/Apache-2.0 | 2026-04-14 | 114 | SVO-DAG, claims **4 cm** | ✗ | ✗ | **No renderer.** Library only. 2026 activity is mostly Dependabot |
| [all-is-cubes](https://github.com/kpreid/all-is-cubes) | MIT/Apache-2.0 | **2026-08-18** | 235 | Mid — recursive blocks (1 level) | Basic | ✗ | Genuinely maintained |
| [voxelG](https://github.com/mstampfli/voxelG) | ⚠️ **NONE** | 2026-08-02 | **1** | High — 64³/16³/4³ bit pyramid | ✓ CA physics @30 Hz | ✓ TCP | Best feature match on paper; **no LICENSE file = legally unusable** |
| [bevy-voxel-engine](https://github.com/ria8651/bevy-voxel-engine) | MIT/Apache-2.0 | 2025-03-14 | 97 | High, GPU raytraced | — | ✗ | **DEAD** (pinned to Bevy 0.12) |
| [jamescatania1/voxel-raymarching](https://github.com/jamescatania1/voxel-raymarching) | MIT | 2026-04-15 | 33 | ~20M voxels, 0.6–0.85 ms @1080p/3080 | ✗ | ✗ | Only credible wgpu candidate. Author notes GI + specular currently **broken** |

### Bevy plugins — all block-scale

| Project | License | Latest | Bevy | Density | Status |
|---|---|---|---|---|---|
| [bevy_voxel_world](https://github.com/splashdust/bevy_voxel_world) | MIT/Apache-2.0 | 0.17.0 (2026-07-05) | **0.19** | **Block-locked** | Best-maintained |
| [bevy_vox_scene](https://github.com/oliver-dew/bevy_vox_scene) | MIT | 0.22.0 (2026-07-24) | **0.19** | Model-scale, has `voxel_size` | Alive, bus-factor 1 |
| [block-mesh](https://github.com/bonsairobo/block-mesh-rs) | MIT/Apache-2.0 | 0.2.0 (2022) | agnostic | Block | Frozen but de-facto standard |
| [fast-surface-nets](https://github.com/bonsairobo/fast-surface-nets-rs) | MIT/Apache-2.0 | 0.2.1 (2025-01-03) | agnostic | SDF/smooth | Frozen, works |
| [building-blocks](https://github.com/bonsairobo/building-blocks) | MIT | 0.7.x (2021) | — | — | **ARCHIVED — dead** |
| [feldspar](https://github.com/bonsairobo/feldspar) | MIT | never published | 0.8 | SDF | **Effectively dead** (2022-08-13) |

**Critical finding: `bevy_voxel_world` is hard-locked to block scale.** Verified in `src/chunk.rs`: `CHUNK_SIZE_U = 32` with the author's own `// TODO: implement a way to change this`. Voxels are `IVec3`-addressed, `world_position() = position.as_vec3() * CHUNK_SIZE_F` — 1 voxel = 1 Bevy unit. There is no `voxel_size` in `VoxelWorldConfig`. High density in Bevy means writing your own WGSL raymarcher.

`building-blocks`' README points users to successors "driven by the feldspar project" — feldspar has been dead since 2022. There is no newer bonsairobo voxel project; the author moved to point-cloud/CAD work.

⚠️ Gotchas: `bevy_vox_scene` moved `Utsira` → `oliver-dew`; canonical repo names are `ilattice-rs` and `ndshape-rs` (bare names 404); **lib.rs is badly stale** for both Bevy plugins — use crates.io/docs.rs.

### Veloren

| Field | Finding |
|---|---|
| Repo | https://gitlab.com/veloren/veloren (GitHub is a read-only mirror) |
| License | **GPL-3.0-or-later** |
| Activity | **Last commit 2026-08-17** — very actively developed. 18,481 commits, v0.18.0 released 2026-01-23 |
| Graphics | **wgpu**, mesh-based greedy meshing, LOD + shadow maps. **No raytracing** |
| **Density** | **Two scales: 1 landscape block = 11×11×11 small voxels** (moving to 1:9). Model voxels ≈ 9 cm **for figures and props only — terrain stays block-scale** |
| Multiplayer | Authoritative client/server, ECS (specs), custom `veloren_network` crate: `Pid` → `Network` → `Participant` → prioritized `Stream`s with configurable ordering/reliability promises. TCP, MPSC, QUIC backends |
| Physics/destruction | Minimal. Mined/exploded blocks **are not persisted**; terrain persistence is explicitly experimental |
| Time to extract anything | **Months.** Monolithic game workspace, no public engine API, no seams designed for reuse |

**Veloren is not a high-density voxel system** and GPL-3.0 governs anything derived. Study its networking crate design; don't plan to harvest its renderer.

### "Hearth"

Two real projects, **neither usable**. [MalekiRe/hearth](https://github.com/MalekiRe/hearth) is AGPLv3, **5 commits, README-only** — a design document with zero voxel content. `noahsabaj/hearth-engine` returns empty on every fetch attempt including via ungh.cc — most likely deleted or private, despite a live marketing site claiming v0.35. ⚠️ Any "1 cm voxel" claim about it is **uncorroborated**.

### Rust networking — the one solved part

The stack converged in 2026: **lightyear 0.29 now depends on bevy_replicon for replication and aeronet for IO.** They're layers, not competitors.

| Crate | License | Latest | Last push | Bevy | WASM |
|---|---|---|---|---|---|
| [bevy_replicon](https://github.com/simgine/bevy_replicon) ⚠️ *moved from projectharmonia* | MIT/Apache-2.0 | **0.42.2** (2026-08-14) | 2026-08-14 | 0.19 | backend-dep |
| [lightyear](https://github.com/cBournhonesque/lightyear) | MIT/Apache-2.0 | **0.29.0** (2026-08-10) | **2026-08-18** | 0.19 | **Yes** |
| [bevy_renet](https://github.com/lucaspoffo/renet) | MIT/Apache-2.0 | 5.0.0 (2026-06-20) | 2026-06-20 | 0.19 | No |
| [aeronet](https://github.com/aecsocket/aeronet) | MIT/Apache-2.0 | 0.21.0 (2026-06-24) | 2026-08-16 | 0.19 | Yes |
| [matchbox](https://github.com/johanhelsing/matchbox) | MIT/Apache-2.0 | 0.14.0 (2026-02-13) | 2026-06-02 | 0.18 | Yes (WebRTC P2P) |
| naia | MIT/Apache-2.0 | 0.25.0 | 2026-08-16 | 0.18 | Yes | *Erratic (17-month gap) — skip* |
| laminar | — | 0.5.0 (**2021**) | 2023-10-18 | — | — | **DEAD** |

Fastest path: **bevy_replicon 0.42.2 + bevy_replicon_renet on Bevy 0.19 → hours** to two players seeing each other. ⚠️ Replicon's own README lists `bevy_replicon_snap`, `bevy_timewarp`, `bevy_replicon_repair`, `bevy_replicon_attributes`, `bevy_bundlication` as **unmaintained** — don't plan around them.

**Voxel-specific:** chunk payloads are large and reliable-ordered. Both renet and lightyear fragment above ~1200 bytes. Put chunk data on a dedicated reliable channel and keep entity replication separate — don't push voxel data through the replication system.

---

## §6. Engine-integrated voxel tools

### Godot — `Zylann/godot_voxel`

| Field | Finding |
|---|---|
| URL | https://github.com/Zylann/godot_voxel · [docs](https://voxel-tools.readthedocs.io/) |
| License | **MIT** |
| Language | C++ 93%, GDShader. Ships as engine module **or** GDExtension (GDExtension CI exists but README still lists "Make GDExtension work" as roadmap — treat as less mature) |
| **Density** | **Not high-density.** Polygon-based: voxels are meshed into chunk meshes. Blocky (`VoxelMesherBlocky`, `VoxelMesherCubes`) or smooth SDF with **Transvoxel** LOD (`VoxelLodTerrain`). No raytraced/SVO path |
| Multiplayer | `VoxelTerrainMultiplayerSynchronizer` on Godot's high-level MP API, server-authoritative — but docs say *"still very experimental."* **`VoxelLodTerrain` has no multiplayer support** |
| Physics | Godot physics + fast Minecraft-like collision path (`VoxelBoxMover`); runtime editing via `VoxelTool` |
| Activity | **v1.6 released 2026-02-04**, commits through Aug 2026. 4,947 commits, 3.7k★ |
| Time to scene | **Days.** Prebuilt binaries + Quick Start + `Zylann/voxelgame` demo project |

Best "plugs into a mainstream engine, permissive license, actually shipping" option — but it's **terrain tech, not Teardown-class small-voxel tech.**

### Unreal

**There is no actively-maintained, permissively-licensed, high-density voxel plugin for Unreal in 2026.**

- **[Voxel Plugin 2](https://voxelplugin.com)** — fully commercial, **$349 perpetual ex-VAT**, no longer on Fab, direct sale only. **Hard cap: projects with >$100k USD budget must negotiate a custom license.** Still labelled beta (2.0p8).
- **[VoxelPluginFreeLegacy](https://github.com/VoxelPlugin/VoxelPluginFreeLegacy)** — ⚠️ **not open source.** No license file, no detected license on GitHub; governed by the original marketplace EULA. Still maintained enough to compile on UE 5.6/5.7/5.8. 1.8k★, **zero releases**.
- **[VoxelPlugin/VoxelCore](https://github.com/VoxelPlugin/VoxelCore)** — MIT, but ⚠️ **not voxel terrain.** It's the utility module: faster containers (`TVoxelMap`, `FVoxelBitArray`), messaging, profiling, zip reader. No meshing or terrain ships here.

### Unity

Weakest of the three. Best OSS candidate is [BLaZeKiLL/VloxyEngine](https://github.com/BLaZeKiLL/VloxyEngine) (MIT, C#/Burst/Jobs, 128★) — but **last release v1.2.0 was 2024-05-06** and its own roadmap shows Serialization ✗, Noise ✗, **Networking ✗**. Blocky chunks only. Commercial options (Voxeland, Voxelica, Voxel Play) are paid and closed; Ultimate Terrains is no longer updated.

### Standalone engines and tooling

| Project | License | What it is | Density | Activity |
|---|---|---|---|---|
| [VoxelCore](https://github.com/MihailRis/voxelcore) | ⚠️ **NO LICENSE FILE** | Standalone C++/LuaJIT/OpenGL engine, 5,994 commits, 1.4k★ | Block-scale | v0.31.4 (2026-05-04), pushed 2026-08-17 |
| [vengi](https://github.com/vengi-voxel/vengi) | MIT | ⚠️ **Tooling only** — voxedit GUI + voxconvert + thumbnailer. 22,165 commits | n/a | v0.5.0 (2026-04-18) |
| [IOLITE](https://github.com/MissingDeadlines/iolite) | ⚠️ **Proprietary** | Genuinely high-density (Vulkan real-time path tracing, no RT hardware needed) with **real Teardown-style destruction** (6-connectivity analysis, fracturing) | 256³ per shape | **Stalled.** Repo squashed to 1 commit; last release v0.5.1 (2025-06-03); site footer still says "© 2024" |
| [Avoyd](https://www.avoyd.com) | Proprietary | Tooling + paused game. Octree, **262,144 voxels/side**, 65,535 materials, Vulkan path tracer | Genuinely high | FAQ updated 2026-05-16. Windows only |
| MagicaVoxel | Proprietary freeware | Tooling. Only the [.vox format spec](https://github.com/ephtracy/voxel-model) is public | Caps at 2000×1000×2000, 255 colours | 0.99.7.2 (2025-07-12) |

⚠️ **License landmine, flagged loudly:** IOLITE's README says *"This project is currently being restructured and will return as an open source project in 2026."* **As of 2026-08-18 that has not happened.** It's the closest thing to Teardown in spirit and worth re-checking in Q4, but it is currently unavailable — the download pages have been stripped from the site.

⚠️ **VoxelCore's license is the single biggest open question in the tooling section.** No LICENSE file at repo root via three separate paths; GitHub's sidebar shows no license badge. Sources claiming MIT are not backed by a visible file. **Treat as all-rights-reserved.**

---

## §7. Luanti (formerly Minetest) — where it actually sits

**Renamed from Minetest 2024-10-13** ([announcement](https://blog.luanti.org/2024/10/13/Introducing-Our-New-Name/) — Finnish *luonti*, "creation", + *Lua*).

| Field | Finding |
|---|---|
| License | **LGPL-2.1-or-later** (relicensed from GPL 2012–2013). Bundled assets under separate terms. Note LGPL means you must be able to relink |
| Language | C++ core, **Lua (LuaJIT)** modding API, forked Irrlicht, SDL2 required for the client since 5.15.0 |
| **Density — the answer** | **Low, and structurally fixed.** A node is **1×1×1**. A MapBlock is 16×16×16 nodes. World extent ~±31,000 nodes/axis. The data model is **one node ID + param1 + param2 per node — there is no sub-node voxel data.** Nodedefs give sub-node *visual/collision* geometry only (`nodebox`, `mesh` drawtypes, param2-driven `leveled` heights). You can make a node *look* like a staircase or an arbitrary mesh; you cannot store or edit voxels finer than one node |
| **High-density fork?** | **None found.** ⚠️ This is a searched-for negative, not a proof — but I looked specifically for forks/mods with smaller nodes or sub-node resolution and found only workarounds (mesh drawtypes, `stujones11/meshnode`) |
| Multiplayer | **Its strongest attribute by far.** Client/server is the *only* architecture — singleplayer runs an embedded server. Authoritative server, public server list, mature protocol, years of hardening |
| Physics/destruction | Simple AABB node collision. No rigid bodies, no fracture, no chunk physics |
| Maturity | 13.5k★, in continuous development since 2010 |
| Activity | 5.15.0 (2026-01-20) → 5.15.2 (2026-04-14, security) → 5.16.0 (2026-05-08, **marked broken by maintainers**) → **5.16.1 stable (2026-05-10)** → 5.17.0-rc1 (2026-08-13) |

**Verdict on density:** Luanti sits at the *far low-density end* — genuinely Minecraft-grade, 1 m nodes, no sub-node voxels, no path to higher density without forking the core map format. What it buys instead is the best multiplayer story, the fastest iteration loop, and a clean license. **If your requirement is small voxels, Luanti is the wrong tool and no fork rescues it.** But per §9, small voxels are not your requirement.

⚠️ **A bare Luanti install ships with NO game** — Minetest Game was removed in 5.9.0. You write a minimal `game.conf` plus one mod, or install a GPL-3.0 game like VoxeLibre/Mineclonia.

---

## §8. Recent news (2025–2026)

- **Teardown multiplayer shipped 2026-03-12** (free, PC, 8-player TDM + campaign co-op up to 12, modded servers). "Relics of Barkuna" DLC 2026-06-10.
- **Cubzh → Blip went Apache-2.0** — the most significant open-sourcing in this space. See §0.
- **Hytale is not dead and did not release source.** ⚠️ **Your brief's premise is wrong in both directions.** Cancelled by Riot 2025-06-23 → founders reacquired the IP 2025-11-17 → **paid Early Access 2026-01-13** → weekly updates through 2026. There is **no shared-source release**: [HypixelStudios](https://github.com/orgs/HypixelStudios/repositories) has **0 public repos** and hytale.com/news has no such entry. What exists is **official Javadoc at docs.hytale.com ("Hytale Server API 0.5.4", stamped 2026-06-06)** plus an unobfuscated JAR — almost certainly the source of the rumor. Javadoc footer: *"Copyright © Hypixel Studios Canada Inc. All rights reserved."*
- **Minecraft Java removed obfuscation** — announced 2025-10-29, first fully unobfuscated release **26.1 (2026-03-24)**. ⚠️ **This is deobfuscation, NOT open source.** EULA unchanged. Separately, Minecraft Java is **replacing OpenGL with Vulkan** (experimental multithreaded renderer in snapshot 26.2-snapshot-1, 2026-04-07).
- **Atomontage pivoted to AI + cloud** — "Virtual Matter™, progressively streamed **microvoxels**", browser-based, prompt-to-world, instant multiplayer via URL. Did not ship an engine product, did not open source, did not shut down.
- **Enshrouded** (Keen Games, dynamic voxel world): 5M players, 1.0 on 2026-10-15. Three GPC 2025 talks on their engine, including [water sim + **network sync** in a dynamic voxel world](https://static.graphicsprogrammingconference.com/public/2025/slides/water-simulation-and-rendering-in-enshrouded/Mantler-Koenen-water-simulation-rendering-in-enshrouded.pdf) — directly relevant if you ever need to network voxel changes.
- **Lay of the Land** — full release 2026-04-08, solo dev, fully simulated destructible world with hardware RT.
- **Voxile** (VoxRay Games) — Steam EA 2025-03-10, bespoke ray-traced voxel engine *and* bespoke programming language.
- **Cubyz** — [PixelGuys/Cubyz](https://github.com/PixelGuys/Cubyz), GPL-3.0, **Zig** + OpenGL 4.3, client/server with pubkey auth at 20 tps, 3.6k★, pushed 2026-08-17. The most interesting *new* blocky engine.
- ⚠️ **GPC 2026 program not yet published** — acceptance notifications were due 2026-08-17, so it should populate within days. Worth checking [graphicsprogrammingconference.com](https://graphicsprogrammingconference.com/).

### Voxel-heightmap hybrids (Voxel Space / Comanche)

Invented by Kyle Freeman at NovaLogic; a 2.5D CPU renderer over paired heightmap + colormap, iterating front-to-back with a **y-buffer** (one scalar per screen column holding the highest y drawn), giving exact occlusion with no z-buffer. Fatal limit: **one height per (x,y)** — no overhangs, caves, or buildings. It died because a serial per-column CPU scanline sweep got **zero benefit from 3dfx-era accelerators**. All NovaLogic patents (US6020893A, US5550959A) **expired 2017**.

The canonical repo, [s-macke/VoxelSpace](https://github.com/s-macke/VoxelSpace) (MIT, 6.8k★), has been **frozen since 2020-01-03** — and its maps are reverse-engineered from Comanche and explicitly excluded from the MIT grant. Two 2025–26 items are genuinely usable: [webgpu-native-examples](https://github.com/samdauwe/webgpu-native-examples) `voxel_space.c` (Apache-2.0, **WebGPU compute shader**, file updated 2026-06-07) and [panorama-cpp](https://github.com/pavel-perina/panorama-cpp) (MIT, C++23 + WASM, raycasts real SRTM data into annotated terrain panoramas, 2026-08-01).

⚠️ **A common myth worth killing:** GPU heightfield raymarching (parallax occlusion, relief mapping, cone-step mapping) *is* everywhere in production, but it descends from **Policarpo/Oliveira/Comba relief mapping (2005)**, not from Kyle Freeman. The resemblance is convergent, not genealogical. Also: **Outcast used a similar technique, not NovaLogic's engine** — a frequent error.

---

# Part II — Your actual decision

---

## §9. Reframing against brief v0.1

Your brief changes the question completely. Restating what the engine must provide:

1. Spawn and move entities on command from an external process
2. Render dialogue text near those entities
3. Let a visitor walk around a plaza and three buildings
4. Emit world events (proximity, chat, area entry) back out in a normalized schema

**Not required:** physics, destruction, terrain editing, fluid sim, high voxel density, or honestly any voxels at all.

That means the ranking criterion is: **how good is the scripting/bot/network interface for external control, and how reliable is the runtime.** Rendering fidelity is a tiebreaker at best. Everything in §4 and §5 — the entire high-density research ecosystem — is **disqualified**, not because it's bad but because none of it has an entity system, a scripting API, a networking layer, or a text renderer. You would be building all four.

One more thing the brief implies but doesn't state: **your Day-4 kill switch is a distribution decision as much as a technical one.** If the fallback is "demo in a Telegram group," then the 3D client's value is that a stakeholder can *see* it. Several otherwise-strong options can't hand someone a link. Settle the viewing model on Day 1, not Day 8.

---

## §10. Ranked shortlist

### 🥇 1. three.js + `ws` (DIY, Node-native) — **1.5–3 days**

**Integration path:** Node server ↔ `ws` websocket ↔ browser three.js client. There is no adapter boundary to cross — it's JavaScript on both sides, and your normalized event schema is just the wire protocol.

**Verified stack:** `three` 0.185.1 (2026-07-01, MIT) · `@react-three/fiber` 9.7.0 (⚠️ requires React 19) · `@react-three/drei` 10.7.8 · `troika-three-text` 0.52.5 · `ws` 8.21.3. Confirmed by inspecting the published drei tarball: `PointerLockControls`, `Billboard`, `Text` (wraps troika), `Html`, `Instances`. `PointerLockControls` is also built into three at `three/addons/controls/PointerLockControls.js`.

**Effort breakdown:** FPS controller ½ day · plaza + 3 buildings from boxes 2–3 hours · NPC mesh + billboard label + position lerp ½ day · wire protocol ½ day · proximity events (naive O(n²) in Node) free.

**Push:** native bidirectional websockets. No polling anywhere.

**Why it wins:** it is the only option where a stakeholder clicks a URL and is standing in the plaza. Zero install, zero NAT traversal, zero version-matching, works on a phone. Your team already writes Node. Every day you don't spend fighting an engine goes into the Host Mind, which is your actual differentiator.

**Biggest risk: scope creep.** Someone will want rigged avatars, animations, and a navmesh, and burn four days. Write down on Day 1 that NPCs are capsules with name labels.

**Skip Colyseus** — it's alive (0.17.x, MIT) but its value is multi-player state sync you don't need; that's a day of learning tax. **Skip Geckos.io** — UDP for fast action, irrelevant at walking speed.

---

### 🥈 2. Minecraft + mineflayer — **0.5–1 day, but do not ship it publicly**

**Integration path:** `itzg/minecraft-server` in Docker + one mineflayer bot per NPC **running inside your existing Node process.** The engine control API *is* JavaScript. There is genuinely no integration layer.

**Verified:** mineflayer **4.37.1** (2026-05-03), MIT, `node>=22` (matches your stack exactly), supports MC 1.8–1.21.11, actively released through 2026. `mineflayer.createBot({host, port, username, auth, version})`, `bot.chat()`, `bot.setControlState()`, `bot.lookAt()`, `bot.nearestEntity()`, events `'chat'`, `'playerJoined'`, `'entityMoved'`, `'physicsTick'`. ⚠️ `mineflayer-pathfinder` on npm is 2.4.5 from 2023-09-04 while master is 2.5 years ahead — install from git.

**Push:** full native bidirectional over persistent TCP. Events arrive as EventEmitter callbacks.

**Prior art is extensive:** [mindcraft](https://github.com/mindcraft-bots/mindcraft) (5.6k★, MIT, pushed 2026-06-10) is a live LLM-NPC framework on mineflayer. Voyager ([arXiv:2305.16291](https://arxiv.org/abs/2305.16291)) and Project Sid ([arXiv:2411.00114](https://arxiv.org/abs/2411.00114)) both proved this path. 59 GitHub repos match `mineflayer + llm`. This is well-trodden ground.

**Text bubbles:** no client-side API. Op the bot and `bot.chat('/summon text_display ...')` (verified: `lib/plugins/chat.js` sends `/`-prefixed messages unsplit), or write a small Paper plugin using `TextDisplay` (1.19.4+; the real API is `text(Component)`, **not** `setText`).

**🚩 The risk is legal, not technical.** The [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines) require that server access *"must only be granted to users who have a genuine paid-for version"*, and **commercial companies may not use Minecraft gameplay to promote products without prior written approval from Mojang/Microsoft.** A company demoing its LLM-NPC product is precisely the prohibited case, and that approval will not close in 10 days.

**Use it as your Day-1–2 harness.** Prove the Host Mind → adapter → entity loop against mineflayer in half a day; that de-risks the interface almost for free. Then ship the public demo on three.js.

---

### 🥉 3. Godot 4 — **1–1.5 days if someone knows Godot, 3–4 if not**

**Integration path:** Godot client with one `WebSocketPeer` to your Node server, polled in `_process()`. **Skip Godot's high-level multiplayer API and skip a Godot headless server entirely** — Node is already authoritative, so Godot should be a dumb render/input terminal.

**Verified (4.7.1, built 2026-07-14):** `WebSocketPeer.connect_to_url()`, `poll()`, `get_ready_state()`, `send_text()`; ⚠️ `get_packet()` / `get_available_packet_count()` are **inherited from `PacketPeer`**, not declared on WebSocketPeer — a documentation trap. ⚠️ **`WebSocketClient` is GONE in Godot 4** (Godot 3 only). `Label3D` with `billboard = BILLBOARD_FIXED_Y` for dialogue. `CharacterBody3D` — ⚠️ **`move_and_slide()` takes NO arguments in Godot 4**; set the `velocity` property. `Area3D.body_entered` for proximity. `CSGBox3D` / `GridMap` for the district.

⚠️ **Every `NavigationAgent3D` / `NavigationRegion3D` class carries an official "Experimental" banner.** Mitigate by not using navmesh at all — have Node send waypoints and `move_toward` between them. That deletes an experimental subsystem from your critical path, and it's the right architecture anyway since Node owns pathing decisions.

**Do not touch `godot_voxel`.** It's for infinite destructible terrain, wildly out of scope, and costs a day in build setup alone. Thirty `CSGBox3D` nodes is an afternoon.

**Biggest risk: web export.** It works and threads are now optional (no COOP/COEP headers needed since 4.3), but the whole game preloads before anything renders (~5 MB Brotli minimum), **the socket dies when the tab is backgrounded**, and Safari has WebGL 2.0 quirks. Budget +1.5–2 days. Ship desktop-first; decide web on Day 6.

---

### 4. Luanti — **2–4 days. Viable. See §11 for the full treatment.**

---

### 5. Hyperfy — **timebox 4 hours, then abandon**

[hyperfy-xyz/hyperfy](https://github.com/hyperfy-xyz/hyperfy), **GPL-3.0**, 292★. It genuinely has all four of your primitives out of the box: `world.add()` / `app.create()` / `prim`, `player.teleport()`, `nametag` + head-tracking chat bubbles, `world.on('enter'|'leave')` + `world.overlapSphere()`, and `fetch` exposed to app scripts. `agent.mjs` in the repo root is a **headless Node client** (`createNodeClientWorld()`, `world.controls.simulateButton('keyW', true)`, `world.chat.send()`) — real push, no polling.

**But: last commit 2025-12-18 — 8 months dormant**, self-described alpha with "APIs highly likely to change," GPL-3.0, and the AI-agent story is a link farm (its ElizaOS integration has been dead 19 months).

Those primitives are worth ~2–3 days of savings if they work. Test `npm run dev` + `agent.mjs` on Day 1 with a **hard 4-hour cap**; abandon on any failure. It is not worth debugging a dormant alpha on Day 9.

---

### 6. Blip — **don't**

Technically 2–4 days and the API design is genuinely excellent (§0). But the runtime appears unmaintained: no app-store build in 12 months, broken web build, unanswered "is development stopped?" issue. Your demo would live entirely on infrastructure nobody appears to be watching.

---

### ❌ Fantasy for 10 days

| Option | Why it's out |
|---|---|
| **Anything in §4 (SVO/DAG/brickmap)** | No entity system, no scripting, no networking, no text rendering. You'd build all four before the first NPC speaks |
| **Veloren** | A WASM plugin system *is* merged (`plugin/wit/veloren.wit`, wasmtime component bindgen) but is behind a non-default cargo feature and its entire surface is `register-command`, `player-send-message`, `register-animation`, and a read-only `entity`. **No spawn. No move.** The headless CLI's axum API (`/ui_api/v1`) does global chat only. The only real path is a bot logging in as admin issuing `/sudo uid@<n> say <text>`. GPL-3.0. **6–10 days optimistic, 2–3 weeks realistic** |
| **Hytale** | Premise is wrong — no source release happened (§8). API shape is right (`SpawnUtil`, `Entity`, `Nameplate`, `EventBus`, Java plugin JARs) but it's all-rights-reserved, ToS bars reverse engineering and commercial use without permission, and **every visitor must buy and install the paid client.** Technically ~3–5 days, contractually and logistically zero |
| **Octo** | No source. Binary only |
| **IOLITE** | Not downloadable. The open-source promise hasn't landed |
| **Hyperia / hyperforge** | `lalalune/hyperscape` 301-redirects to [PlayHyperia/hyperforge](https://github.com/PlayHyperia/hyperforge) — it's now a RuneScape-like MMORPG, not a world engine. Needs Bun, Git LFS (~200 MB assets), Docker, PostgreSQL and a **Privy account** for auth. You'd spend the sprint deleting an MMO to find your plaza. **5–10+ days** |
| **Unreal / Unity voxel plugins** | Either $349 with a $100k budget cliff, or unlicensed legacy, or a 2024-frozen MIT package with `Networking ✗` on its own roadmap |

---

## §11. Luanti as incumbent — what external NPC control actually takes

Since it's the working assumption, here's the detailed answer.

### The integration path

```
Node server  ←── HTTPS long-poll ──  Lua mod
                                     │  core.request_http_api()  (grabbed at init.lua top level)
                                     ├─ core.add_entity(pos, "mymod:npc")
                                     ├─ on_step(self, dtime) → lerp toward target
                                     └─ obj:set_nametag_attributes{text = "..."}
Node server  ←── HTTPS POST ────────  world events (join, chat, proximity)
```

### Verified APIs

All confirmed against api.luanti.org and engine source (`l_http.cpp`, `l_env.cpp`, `s_security.cpp`, `builtin/game/misc.lua`):

| API | Status |
|---|---|
| `core.add_entity(pos, name, [staticdata])` | ✅ returns ObjectRef or nil |
| `luaentity` + `on_step(self, dtime, moveresult)` | ✅ |
| `move_to(pos, continuous)` | ✅ interpolated for Lua entities. ⚠️ For *players* it's just `set_pos` and `continuous` is ignored |
| `set_velocity` / `set_acceleration` / `set_yaw` / `get_luaentity` / `remove` | ✅ **LuaEntity-only** — `set_velocity` is a silent no-op on players (use `add_velocity`) |
| `chat_send_player` / `chat_send_all` | ✅ |
| `set_nametag_attributes{text=, color=, bgcolor=}` + `nametag_fontsize` | ✅ works on non-player objects — this is your dialogue rendering |
| `register_globalstep`, `core.after`, `register_on_chat_message`, `register_on_joinplayer` | ✅ |
| `get_objects_inside_radius(center, radius)`, `get_objects_in_area(min, max)` | ✅ proximity events |
| `ObjectRef:get_guid()` | ✅ **stable ID surviving reloads** — ideal as the shared NPC key with Node |
| `minetest.*` → `core.*` | ✅ alias retained |

⚠️ **`hud_add` is player-only.** You cannot attach a HUD to an entity. Nametags are your only text-near-entity mechanism without writing a client mod.

### Push vs poll — the crux

**Polling-only. There is no inbound socket anywhere in the sandboxed API.** No websocket, no bind, no accept, no listen. `http:fetch(req, callback)` isn't even a real async primitive — `builtin/game/misc.lua` implements it as `fetch_async` + `core.after(0, ...)` polling `fetch_async_get`. Responses are **fully buffered** (`data` is one complete string), so SSE and chunked streaming are out.

**The correct pattern is HTTP long-poll.** `method` supports GET/HEAD/POST/PUT/PATCH/DELETE (POST confirmed). Set `timeout` to ~25–30 s, have Node hold the request open until it has a command batch, fire the Lua callback, re-arm immediately. One RTT of latency, no busy-polling. Keep 1–2 requests in flight total, **not one per NPC**.

### The configuration trap that will eat your first afternoon

One line in `minetest.conf`:

```
secure.http_mods = my_npc_mod
```

Leave `secure.enable_security = true`. Two non-obvious findings from source:

1. **Disabling security does NOT grant HTTP access.** The whitelist check in `l_request_http_api` is unconditional.
2. **`request_http_api()` must be called from `init.lua` main scope.** Verified: `getCurrentModName` requires `info.what == "main"`. Called from a callback it silently returns `nil`. This is the #1 thing that will break your first run.

`core.request_insecure_environment()` (for LuaSocket etc.) requires `secure.trusted_mods` specifically — `http_mods` does *not* grant it. And **LuaSocket doesn't ship with Luanti** anyway; there's no socket target in the build. Not worth pursuing.

### Ecosystem

- **Skip the mob frameworks.** mobs_redo (Codeberg, MIT, active 2026-08-17), mobkit, and creatura all exist to supply *autonomous AI* — the exact thing your Host Mind already does. You'd spend the sprint disabling them. Write a bare `core.register_entity` with a lerping `on_step` (~50 lines). Steal `character.b3d` and `set_animation` for looks. ⚠️ `advanced_npc` is dead (2017, GPLv3).
- **LLM prior art is near-zero:** `talkers` (MIT, 5.6 KB, Ollama, last release May 2025) and `ShameGPT` (an April Fools chat command). Read `talkers.lua` for twenty minutes, then write your own.
- **There is no mineflayer equivalent. Flatly none.** Zero Python, zero JS client libraries. Only a Go proxy stack (`mt-multiserver-proxy`) and a partial Rust crate with no SRP auth. `doc/protocol.txt` is titled "incomplete, early draft" and was **last updated 2011-06-18**; the C++ source is the spec and the wire format breaks every minor release. **This doesn't matter for you** — your NPCs are server-side entities, not headless players. Push back hard if anyone proposes a bot client.
- **Headless:** `luantiserver` (renamed in 5.10.0), official `ghcr.io/luanti-org/luanti` Docker image. ⚠️ `linuxserver/minetest` is **deprecated**. The server isn't built by default (`BUILD_SERVER=FALSE`) — use Docker.

### Verdict: is Luanti easier or harder than the top alternatives?

**Harder than three.js, harder than mineflayer, roughly comparable to Godot — and the gap is almost entirely in distribution, not NPC control.**

The Lua API genuinely does everything your brief asks for, and 2–4 days to a talking NPC is realistic for a Node dev with no Lua background. The polling constraint is real but manageable at conversational latency; long-polling gets you well under a second, and NPC dialogue is not a twitch-shooter workload.

**What kills it is who can see the demo.** No browser client (the WASM port's own demo site says "Coming soon"), no iOS, UDP 30000 through visitors' NAT, version-locked client/server, and a first-time visitor lands in a client with **no game installed**. If "send stakeholders a link" is part of the demo, Luanti cannot do that and three.js can.

Keep Luanti if the voxel aesthetic is load-bearing for the pitch and you control the viewing environment (everyone in one room, clients pre-installed). Drop it otherwise.

---

## §12. Recommended plan

**Two-track, with the Day-4 kill switch preserved.**

**Days 1–2 — de-risk the interface.** Stand up `itzg/minecraft-server` in Docker and drive one mineflayer bot from the Host Mind. Half a day to a talking NPC. This validates your adapter interface, your event schema, and the Host Mind loop against a real engine before you've committed to anything. Legally it can't be the public demo, which is fine — it's a test harness.

**Days 1–2, in parallel — build the shippable client.** three.js + `ws`. FPS controller, plaza and three buildings from boxes, capsule NPCs with billboard labels. This is where a Node shop is fastest and it's the only option that hands a stakeholder a URL.

**Day 1, 4-hour timebox — evaluate Hyperfy.** If `npm run dev` + `agent.mjs` work first try, it saves you 2–3 days of client work. If anything resists, abandon immediately.

**Day 4 checkpoint.** You should have a tick loop, a moving NPC, and a line of dialogue in the browser. If not, your Telegram fallback is intact and you've lost nothing, because the Host Mind and the canon DB were never engine-coupled.

**Day 6 decision.** Whether to attempt anything beyond the browser client. The honest answer is probably no.

**What to explicitly not do:** don't build on any §4 renderer, don't touch `godot_voxel`, don't write a Luanti bot client, don't add Colyseus, don't build a navmesh. Node owns pathing; the engine gets waypoints.

**The uncomfortable truth worth stating plainly:** given the brief, the strongest engine choice involves no voxels at all. If voxel aesthetics matter to the pitch, the cheapest way to get them is a MagicaVoxel `.vox` model loaded into three.js via [ogt_vox](https://github.com/jpaver/opengametools) or a three.js `.vox` loader — an afternoon of work — rather than adopting a voxel *engine* and inheriting its distribution problems.

---

## §13. Confidence & gaps

**High confidence (primary source read directly):** all Luanti API and security behaviour (engine source), Blip's Luau sandbox and HTTP egress (engine source), all GitHub license/activity rows, Teardown's multiplayer architecture and rendering approach (his own blog + two independent RenderDoc breakdowns), mineflayer version and API, Godot 4.7.1 API signatures, the Hytale correction.

**Verified-but-inferred:** Teardown's 10 cm voxel size — wiki, community convention, and my own arithmetic against two RenderDoc captures all agree, but it is not in official Tuxedo Labs documentation.

**Explicitly unverified:**

1. **"Blipp" identification.** I'm confident it's Blip, but I could be wrong about what you meant.
2. **Blip's Apache-2.0 relicensing date** and the private-repo import date. The most valuable finding in the survey and the least nailed down.
3. **Octo's exact voxel edge length** and whether development is genuinely Patreon-gated.
4. **VoxelCore (MihailRis) license** — no LICENSE file found via three separate paths. Highest-priority thing to resolve before any use of that project.
5. **`VoxelPluginFreeLegacy` license** — confirmed absent from GitHub; governed by the old marketplace EULA, which I did not read.
6. **"No high-density Luanti fork exists"** is a searched-for negative, not a proof.
7. **`godot_voxel` minimum practical voxel size** — no published figure; the "not high-density" call is inferred from its polygon-meshing architecture, which the README states plainly.
8. **GPC 2025 slide deck contents** — the 119 MB PDF was blocked by the sandbox's egress allowlist. If you want ground truth on Teardown's new renderer, that PDF is the artifact to obtain.
9. **r/VoxelGameDev was never directly surveyed** — Reddit is fetch-blocked in this environment. There are likely additional Vulkan HW-RT voxel projects not surfaced here.
10. **All "days to X" figures are estimates** derived from example availability and toolchain gating, not measured.

**Legal landmines, collected:** no LICENSE file at all (⇒ all rights reserved) on `GabeRundlett/voxel-raster`, `GabeRundlett/voxlife`, `Ipotrick/Sandbox`, `gegoggigog/DAG-example`, `Snektron/Xenodon`, `DouglasDwyer/octo-release`, `MihailRis/voxelcore`, `mstampfli/voxelG`, `VoxelPlugin/VoxelPluginFreeLegacy`. Voxedia is CC BY-NC-ND (**not** open source despite its README). SymVox, DAGger, Veloren, Cubyz and several Luanti games are GPL-family.
