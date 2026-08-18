# John Lin's Voxel Engine Work — Research Dossier

**Compiled:** 2026-08-18
**Subject:** John Lin — GitHub `Lin20`, X `@ProgrammerLin`, blog `voxely.net/blog`, YouTube `UCM2RhfMLoLqG24e_DYgTQeA`
**Purpose:** Evaluate reusability for "Inspiral" (10-day hackathon, Luanti/Minetest + LLM NPCs, Animoca/Moca "Mind" hackathon)

---

## 0. Executive summary — read this first

**The famous engine is not the code on GitHub, and the code on GitHub is not the famous engine.** This is the single most important fact in this document, and almost every casual reference to "John Lin's voxel engine" conflates the two.

| | Public GitHub work (2015–2018) | The famous work (2020–2021) |
|---|---|---|
| What it is | Isosurface extraction / smooth-terrain LOD meshing | Path-traced micro-voxel sandbox with fluids, physics, animated trees |
| Rendering | OpenGL 4.0 **rasterization**, no raytracing at all | **Vulkan path tracing**, 5-bounce GI |
| Voxels | 32³ dense chunks, discarded after meshing | ~512× density claim, persistent, per-voxel material attributes |
| Source | **Public, MIT** (`BinaryMeshFitting`, `isosurface`) | **Never released. Nowhere. Not private-on-GitHub-visible, not on GitLab, not on itch.io** |
| Last code change | **2018** | Never public |

**Status as of today (2026-08-18):**

- Engine is **closed, unreleased, and publicly abandoned**. Last voxel video: **May 2021**. Last voxel blog post: **September 2021**. Last anything: **August 2023** (a blog post about RNN tilemap generation — not voxels).
- **No company. No LLC. No trademark. No funding. No Steam page. No itch.io. No Patreon. No playable build. No published title.** The project never even had a name — the community calls it "John Lin's sandbox" because he never named it.
- He is alive and coding: his newest GitHub push is **2025-04-08**, a Visual Studio 2022 text-effects extension he describes as "vibe coded... in a single afternoon, so thanks to ChatGPT for the help." Nothing to do with voxels.
- Latest community verdict, HN 2026-03-04: *"I think the project was abandoned in 2021."* Nobody contradicted it.

**Bottom line for Inspiral:** there is **nothing here you can drop into a 10-day build.** The reusable artifact is *ideas and a design critique*, plus two MIT-licensed 2018-era C++/C# reference implementations of dual contouring / dual marching cubes that are Windows-MSVC-only and 8 years stale. Skip to §6 for what to actually do instead.

---

## 1. GitHub: `github.com/Lin20`

Profile verified live via the GitHub REST API on 2026-08-18: 1,330 followers, 0 following, **16 public repos**, 0 gists, 0 orgs, account created 2014-01-21. Public events feed is **empty** (GitHub retains ~90 days), so no public GitHub activity since roughly May 2026.

### 1.1 Complete repo inventory

Sorted by last push. `is_fork` flagged. **None archived; every repo's default branch is `master`.**

| Repo | Lang | License | ★ | Forks | Created | Last push | Fork? | Verdict |
|---|---|---|---|---|---|---|---|---|
| Visual-Studio-Code-Effects | C# | MIT | 2 | 0 | 2025-04-08 | **2025-04-08** | no | Unrelated toy (VS2022 extension) |
| **BinaryMeshFitting** | C++ | **MIT** | **396** | 29 | 2018-03-07 | 2021-08-06† | no | Real engine, research-grade demo |
| RakNet | — | NOASSERTION | 0 | 0 | 2021-07-07 | 2020-11-04 | **yes** | Vendored networking fork |
| projectpmr | C++ | GPL-2.0 | 31 | 10 | 2014-03-19 | 2020-08-05 | no | Pokémon Red multiplayer clone, unrelated |
| **PushingVoxelsForward** | C | **MIT** | **145** | 8 | 2017-10-17 | 2018-03-07 | no | Predecessor, superseded by author |
| cachesuite | C# | **none** | 18 | 15 | 2014-11-23 | 2018-01-23 | no | RuneScape cache editor, unrelated |
| ClosestPointContouringTable | C# | **none** | 6 | 1 | 2017-09-20 | 2017-09-20 | no | One-day LUT generator, "untested" |
| **isosurface** | C# | **MIT** | **330** | 41 | 2015-08-22 | 2016-10-23 | no | Algorithm comparison harness (XNA 4.0) |
| ProjectIW | C++ | MIT | 24 | 4 | 2016-10-11 | 2016-10-17 | no | 1-week experiment, 2-line README |
| imgui | C++ | MIT | 4 | 0 | 2016-09-24 | 2016-09-23 | **yes** | Vendored fork |
| ShapeCC | C | **none** | 3 | 0 | 2016-03-03 | 2016-03-03 | no | Learning-C 2D game |
| musiceditor | C# | **none** | 2 | 0 | 2015-12-03 | 2015-12-03 | no | MIDI editor |
| CWWebsite | JS | **none** | 1 | 0 | 2015-09-14 | 2015-09-15 | no | Website dump (54.9 MB) |
| zohs | C# | **none** | 1 | 0 | 2015-01-09 | 2015-01-09 | no | Unknown, no README |
| pokered | Asm | **none** | 0 | 0 | 2014-03-27 | 2014-03-27 | **yes** | Disassembly fork |
| generic-c-hashmap | C | MIT | 2 | 0 | 2017 (fork) | 2012-12-10 | **yes** | Utility fork |

† **Important caveat:** BinaryMeshFitting's 2021-08-06 push was a **README edit only**. The last actual *code* commit is **2018-03-29** — roughly 8.4 years stale. GitHub's `updated_at` shows 2026-08-14 but that is star/watch churn, not a change.

**Licensing:** the three repos that matter (`BinaryMeshFitting`, `PushingVoxelsForward`, `isosurface`) are all **MIT** — genuinely permissive, commercially usable. Seven minor repos have **no license at all** = all-rights-reserved, not legally reusable. `projectpmr` is GPL-2.0.

### 1.2 `BinaryMeshFitting` — architecture (verified by reading the tree)

396★, MIT, C++17. README: *"Yet another attempt at making a fast massive level-of-detail voxel engine, but this time with usable results! This is the successor to PushingVoxelsForward."*

**Directory structure actually observed** (254 blobs via the git trees API):

```
BinaryMeshFitting/         61 files  — engine source
BinaryMeshFitting/GUI/     13 files  — vendored Dear ImGui + stb_*
BinaryMeshFitting/shaders/  4 files  — main_vs/fs.glsl, outline_vs/fs.glsl
BinaryMeshFitting/sparsepp/ 9 files  — vendored sparse hash map
BinaryMeshFitting/{avx,sse,mic,scalar,common,traits}/  — vendored Vc SIMD lib
cmake/Modules/              6 files
```

**Voxel storage — two-level, and notably NOT an SVO/brickmap/DAG:**

- Outer: a **sparse world octree** of `WorldOctreeNode`, keyed by **64-bit Morton codes** with a cached 32-bit hash (`struct MortonCode { uint64_t code; uint32_t hash; }` in `WorldOctreeNode.hpp`). Two hash grids in `WorldWatcher.hpp`: `emilib::HashMap<MortonCode, WorldOctreeNode*> leaf_nodes` and `spp::sparse_hash_map<MortonCode, DMCNode*> chunk_nodes`.
- Inner: **dense flat arrays per chunk**. `DMCChunk` holds `DensityBlock* (float*)`, `BinaryBlock* (uint32_t*, bit-packed inside/outside — the "binary" of the name)`, `DMC_CellsBlock*`, `IndexesBlock*`, all `_aligned_malloc`'d and recycled through `ResourceAllocator<T>` pools. Default chunk resolution **32** (`GUI/WorldOptions.h: #define DEFAULT_RESOLUTION 32`).
- **Critical:** `ChunkGenerator::extract_chunk` frees the binary/density/cell/index blocks immediately after extraction. **Only meshes persist — the voxel data does not.** This is a mesh-extraction pipeline, not a persistent voxel world. There is no editing, no destruction, no per-voxel state.

**Meshing:** dual marching cubes (Nielson) blended with manifold dual contouring's octree traversal, then iterative dual/primal mesh optimization ("dual of the dual operator," Ohtake & Belyaev). Pipeline in `DMCChunk.hpp`: `label_grid()` → `label_edges()` → `snap_verts()` → `polygonize()`. Post-process `Processing::MeshProcessor<N>` (N=3 tris, N=4 quads) offers `optimize_dual_grid()`, `optimize_primal_grid(qef, ...)`, `collapse_bad_quads()`, `collapse_edges()`. **The QEF flag is passed `false` in the shipping path**, so sharp-feature restoration exists in the API but is off — matching the README's unchecked to-do.

**Rendering: rasterization only.** Four GLSL files, all vertex/fragment, `#version 400 core`. Triplanar texturing (mostly commented out), one hardcoded directional light, logarithmic depth buffer (`gl_FragDepth = log_z`) for long view distances. **No raytracing, no compute shaders, no Vulkan, no CUDA.** GPU is a rasterizer + VBO store.

**LOD:** view-distance octree split/group around a `focus_point`, driven by a background `WorldWatcher` thread. Node lifecycle is an atomic state machine (`UNHANDLED → WATCHER_QUEUED → GENERATOR_QUEUED → GENERATING → NEEDS_FORMAT → NEEDS_UPLOAD → UPLOADING → AWAITING_STITCHING → DONE`).

**Crack fixing:** `WorldStitcher.hpp` implements full LOD-seam stitching — but the commit log (2018-03-27) says *"Stitching has been indefinitely replaced by chunk overlapping as a method of crack fixing."* The stitcher is dormant code.

**Threading:** dedicated `std::thread` watcher + **OpenMP** `#pragma omp parallel for` across the chunk-extraction batch functions. GL uploads marshalled back to the render thread.

**Terrain:** `NoiseSampler.hpp` wraps **FastNoiseSIMD** (8 samplers per `Sampler`). Gradients via finite differences (h=0.01).

**Buildability — honest assessment:**

- ✅ Buildable in principle on **Windows/MSVC only**. CMake ≥3.11 or a VS2017 `.sln`.
- ❌ **Not portable.** `__declspec(noinline)`, `__forceinline`, `_aligned_malloc/_aligned_free`, and `MortonCode::calc_hash` calling the MSVC-internal `std::hash<uint32_t>::_Do_hash`. None of this compiles on GCC/Clang without edits.
- ❌ `find_package(Vc REQUIRED)` forces you to install a SIMD library the **README admits is unused**.
- ❌ `DebugScene.cpp` references `rock.jpg`, `rock2.jpg`, `grass.jpg` — **none are committed**. (Mitigated: the texture path in the fragment shader is commented out, so it should render flat-colored.)
- ❌ **0 releases, 0 tags, only `master`.** No tests, no CI, no install target, no headers/library target — a single `add_executable`.

**Verdict:** a runnable flythrough tech demo and a good *reference implementation* of DMC+mesh-optimization. **Not a library.** Effectively abandoned since 2018.

### 1.3 `PushingVoxelsForward` — the predecessor

145★, MIT, pure **C** (not C++), VS2017. Superseded by the author's own README.

- **Storage/LOD: a tetrahedral hierarchy, not an octree.** `THierarchy` with 6 top-level tetrahedra, longest-edge bisection via "diamonds" (`TDiamond` holding up to 128 tetrahedra), keyed in a macro-generated hashmap. `MAX_TREE_DEPTH 20`.
- **Meshing: SnapMC** (extended marching cubes LUT) over dense `UMC_Chunk` grids inside each `Hexahedron`. Pipeline `label_grid → label_edges → snap_verts → polygonize → create_VAO`.
- **Noise:** OpenSimplex (pre-FastNoiseSIMD generation). **Single-threaded.** GUI is Nuklear. OpenGL via GLEW/GLFW.
- Last code commit **2017-11-04**. ~8.8 years stale. Historical interest only.

### 1.4 `isosurface`

330★, MIT, C#. *"A project testing and comparing various algorithms for creating isosurfaces."* Implements 2D/3D uniform and adaptive dual contouring plus dual marching squares. **Requires XNA 4.0** — a dead framework; would need a MonoGame port today. Last commit 2016-10-23.

The author explicitly disclaims it in the README: *"My QEF solver is hardly a QEF solver... so do **not** use this as an example of what to do"* and *"It's not very optimized and it doesn't have much of a use outside of displaying data."* This is nonetheless the most-cited of his repos in the dual-contouring community, and the only one with a confirmed direct port (§5).

### 1.5 Is the famous micro-voxel engine anywhere public?

**No — verified negatively.**

- `users/Lin20/repos?per_page=100` returns exactly **16**, matching `public_repos: 16`. Nothing paginated off. None relate to the 2020–2021 engine.
- `users/Lin20/orgs` → `[]`. `users/Lin20/gists` → `[]`. No side account.
- GitHub repo search for "voxely" returns only unrelated projects (Voxelyze/FEA, imageboard clones).
- No GitLab, Bitbucket, itch.io, or Patreon code drop found via search.

**Unverified:** whether a private repo exists. Obviously unknowable from outside.

---

## 2. Demos and public writeups

### 2.1 YouTube — complete inventory

Channel `UCM2RhfMLoLqG24e_DYgTQeA`, created 2020-03-06, **41.8K subscribers, 14 videos, last upload 2021-05-13.** View counts read 2026-08-18.

| Date | Title | Views | ID |
|---|---|---|---|
| 2021-05-13 | New Voxel Engine Reveal – Crystal Islands Experiment | 390,620 | `8ptH79R53c0` |
| 2021-01-23 | Water Wheels, Motor Concept, and Dynamic Object Building | 89,074 | `8O1bsNaFZLE` |
| 2021-01-18 | Water Physics + Custom Voxel Boats, Rigid Bodies & Destruction | 47,913 | `BoPZIojpbmw` |
| 2021-01-08 | Voxel Water Physics – Waterfalls, Rivers and Tunnels | 119,646 | `1R5WFZk86kE` |
| 2020-12-26 | Voxel Summer Forest Meadows | 30,695 | `CnBIq9KRpcI` |
| 2020-12-19 | The most fun I've had working with voxels | 76,002 | `2iP4qR8supk` |
| 2020-11-01 | Destroying some Voxel Pumpkins with my Pet Wolf | 29,657 | `6Cp9R2JBvoY` |
| 2020-10-10 | Volumetric Terrain Fracturing – Detail Enhancement Preview #2 | 16,567 | `cP2RYpuRtcY` |
| 2020-09-27 | Animated Voxel Trees – Detail Enhancement Preview | 15,596 | `BObFTsNeeGc` |
| 2020-08-21 | This Real-Time 3D Fluid Sim Runs on One CPU Core. | 42,190 | `4Y58Pg9tpSo` |
| 2020-07-12 | Voxels + Physics = A fun way to dig | 29,057 | `UBfRPqKuq2I` |
| 2020-06-16 | Exploring an Infinite Voxel Forest | 37,583 | `1wufuXY3l1o` |
| 2020-03-19 | Ray Traced Reverb, Wind and Sound Occlusion | 101,809 | `UHzeQZD9t2s` |
| 2020-03-06 | Path Traced Voxel Project – it all started with a single arch | 59,295 | `VQv1OEm_www` |

**Misattribution warnings** (these circulate and are wrong):

- `i7vq-HY10hI` is **not his** — it's "Adding A CACHE To My Custom VOXEL Game Engine | Devlog #5" by **voxelbee**. It appears in *The Perfect Voxel Engine* as citation #4, where Lin was pointing at *other* developers.
- `ZxfV7su168U` ("Simulating Procedural Ponds in my Micro Voxel Engine") is by **MishMash**, not Lin. A search summarizer attributed it to Lin with a fabricated July 2026 date. **There is no 2026 Lin content.**

### 2.2 Blog — `voxely.net/blog` (3 posts, total)

| Date | Post | Topic |
|---|---|---|
| 2021-07-27 | Object-Oriented Entity-Component-System Design | ECS architecture, "Onion Engine" layering |
| 2021-09-18 | **The Perfect Voxel Engine** | The important one — data-format philosophy |
| 2023-08-21 | Using a RNN for 2D Tile Map Synthesis | Not voxels |

**The promised rendering/Vulkan post — the one that would have disclosed his actual voxel data structure — was never written.** He promised it in both 2021 posts. It does not exist. This is the central gap in all public knowledge about his engine.

`voxely.net/` root redirects to `/blog/`. No product page, store, download, Discord invite, or mailing list. WordPress 7.0.4 (current), so the site is maintained/auto-updating — the domain has not lapsed.

### 2.3 X / Twitter — `@ProgrammerLin`

Alive, not deleted. 1,564 posts, 21.1K followers, 24 following, joined March 2012. **Last post 2023-08-21.** Guest view caps at ~5 posts, so the bulk (including the water-sim thread PC Gamer cited, `status/1296646481286324224`) needs a logged-in session or archive.org. His posts are mostly media with near-empty text bodies.

### 2.4 Technical disclosures — in his own words

**Resolution and world size** (Crystal Islands description, 2021-05-13):

> "An 8x (512 cubic) detail increase with animation support, high compression rates, and per-voxel material attributes"

> "The effective world size here is 256K^3 and the island is generated once upon startup (like Terraria for instance), which takes about a minute."

Fluids have a hard vertical bound: *"no height range limit beyond the 0-4095 y world boundary"* (2021-01-08).

**Storage — this is the gap.** He never disclosed the structure. He only disclosed what it *isn't*, and he is emphatic about it. From *The Perfect Voxel Engine*:

> "As it turns out for sparse voxel octrees, storage and rendering are the only things they are acceptable (not even great) at."

> "Sparse voxel octrees might be able to hold a couple billion voxels worth of data that we can cast primary and shadow rays against, but how well do they work for collision detection? Global illumination? Path finding? Adding new per-voxel attributes besides just albedo and normals? Dynamic objects?"

And the design-fork framing:

> "If you guessed B, you'd be correct! ... imagine replacing *Vertex* with *Voxel* and suddenly with answer A you've described *Efficient Sparse Voxel Octrees*!"

**His stated answer: no single format.** An *Allocation / Tagging / Conversion* pipeline:

- **Allocation** — swappable allocators (`cpu_recycled`, GPU, disk) hand out volume buffers; the developer never manages lifetime.
- **Tagging** — volumes carry named, typed, bit-width-declared attributes (`albedo` as `u8vec4`, `normal` as `vec3`), with template-based pseudo-reflection.
- **Conversion** — registered conversion operators looked up by name pair, e.g. `get_conversion("terrain_cell", "default")`. He lists these as the target use cases: mesh voxelization, Minecraft map import, CSG→voxel (building system), collision data generation, compressors, procedural vegetation from "seed data," network-ready formats.

His summarizing claim: *"Data conversion has **everything** to do with anything."* The architectural thesis is that the format problem is solved by never committing to a format — the same way `assimp` decouples model files from GPU buffers.

Storage sizes were small: a full building was *"under 3MB"* (2020-12-19).

**Rendering — Vulkan, and he switched away from RTX and then apparently back.** 2020-06-16:

> "the engine is no longer using RTX. The entire renderer has since been redone using a custom ray tracer written with Vulkan Compute. The exact ray tracing performance isn't quite as high as RTX (of course), but it uses an extremely lightweight acceleration structure that actually allows for this type of dynamic scene. I think in the end it's a net win."

But the 2021 blog posts describe a **hardware RT pipeline** — `RayTracedPipeline`, `.rgen`/`.rchit`/`.rahit`/`.rint`/`.rmiss` shader stages, shader binding table, BLAS/TLAS. His mechanism for reconciling dynamic formats with a fixed RT pipeline:

> "By tracking the voxel formats that make up a BLAS' geometries, we can build the SBT with specific intersection shaders that have been tailored to the format design. Callable shaders can also be bound in order to decode attributes that are required in a pipeline."

He calls Vulkan *"the greatest programming API to ever exist."* He explicitly rejected Unity and Unreal: *"Unity is stuck with Mono. Unreal has very limited hardware ray tracing support. Both engines were built with the intent on developers making games with rasterized triangles."*

**Lighting:** real-time path tracing, not voxel cone tracing. Crystal Islands: *"Improved path traced global illumination that features 5 bounces from the sun, atmosphere and all emissive objects."* He conceded *"the path traced denoiser is lacking a spatial filter."* Earlier (2020-03-06) he claimed to have made path tracing *"noiseless and run 20x faster (60fps HD!)."*

**Physics:** contact-based, PGS solver, single-threaded, sharing one voxel structure with everything else (2020-07-12):

> "The world, physics processing, ray tracing (all of the objects are ray traced), lighting, procedural generation, sound tracing and collision detection all use the same voxel data"

> "done on a single CPU thread without any SSE trickery alongside the player input, though it is parallel-ready"

A crucial constraint hint, delivered as an aside: **"Don't worry: we don't rotate our voxels here, because we know better."** Rigid bodies are not resampled voxel grids under rotation. This is the same trick Teardown uses and it is the reason his voxels stay crisp.

**Fluids: MLS-MPM, explicitly credited** (2020-08-21):

> "It's a hybrid lagrangian-eulerian method based on the work by 'Hu, Yuanming and Fang, Yu and Ge, Ziheng and Qu, Ziyin and Zhu, Yixin and Pradhana, Andre and Jiang, Chenfanfu' (2018). Special thanks to Grant Kot..."

> "The entire core of the simulation, as well as the CPU-GPU transfers... is executed on the same main thread and is mostly accelerated using AVX2. It uses C++ and Vulkan, and was ran on a base i7-8700K and 2080 Ti."

Integrated version (2021-01-08): same cell/particle hybrid, *"fully volumetric,"* *"99% multithreaded, with a 1% critical section,"* **4 CPU threads, simulation time never exceeding 8 ms.** Buoyancy is volumetric but coupling is **one-way** — *"the splashes seen are just visual."* He openly asked for help on the water cycle: *"there's no evaporative water cycle... I still don't have a good idea to solve this, but I'm definitely open to any ideas."*

This is the **best-documented and most reproducible part of his work**, because the underlying paper (Hu et al. 2018, MLS-MPM) is public and Grant Kot's implementations are public.

**Creatures and animation — this is his thinnest disclosure, and it is essentially undisclosed.** Total public content: *"a WIP voxel character animation system"* (2020-11-01) and *"512 cubic detail increase with animation support"* (2021-05-13). Trees bend via a wind system that is itself **ray traced** — he mentions *"the wind ray tracing calculations"* and a bug where *"glass was ignored during the wind ray tracing calculations, so the second building doesn't properly block out the wind"* (2020-12-19). He conceded the model is wrong: *"a proper physical response from trees since in reality they're soft bodies and not rigid bodies (mostly). In time, I hope to make this happen!"*

Commenter Julien Siefridt (2021-09-23) laid out the deformation paradox precisely — bending a voxel object requires voxels to appear and disappear at the creases; what happens to a hole cut in a stretched object when it compresses? *"Something Ain't Right."* **Lin never replied.** He has not replied to any blog comment on any of the three posts.

**Audio — genuinely novel and under-discussed:** ray-traced reverb, wind and sound occlusion via OpenAL (2020-03-19, 101K views), sharing the same voxel structure as rendering and physics. If you want one idea from his work that is both cheap and differentiating, this is it (see §6.3).

**Engine architecture:** C++ core + C# via .NET Core, C-ABI function pointers for language agnosticism, **flecs** as the ECS backbone (*"I did try EnTT, but it doesn't work across dynamic libraries"* — a commenter, Richard Biely, disputed this in Nov 2021). Layers: Foundation → Framework → Game → Modding → Launcher. He nicknames it the "Onion Engine." Stated motives for the 2021 rewrite: system modularity, C#/C++ interop, modding extensibility.

Note the ordering: **he stopped shipping demos and started a from-scratch architectural rewrite, and then went quiet.** The last video predates the rewrite blog posts.

---

## 3. Current status — what is actually known

**Confirmed:**

- Closed source. No code release of the path-traced engine, ever, anywhere.
- No company, LLC, studio, or funding. Searches for a "Voxely" trademark return only unrelated marks (THE VOXEL LLC, VOXELWORKS LLC, VOXELAB, VOXLER).
- No Patreon, Ko-fi, itch.io, or Steam developer page. The only Patreon hit is a third party writing *about* his engine.
- No published or announced title. **The project never had a name.** Even in the Jan 2021 PC Gamer piece he *"still has no concrete plans."*
- No press since **January 2021**. No interviews, podcasts, or GDC talks — ever.
- Only biographical trace: his 2020 Twitter bio listed **Tempe, Arizona** (preserved in a NeoGAF thread). No LinkedIn profile surfaced.
- He is alive and coding as of April 2025 (the VS extension).

**Community view, most recent first:**

- **2026-03-04, HN** (`item?id=47245143`, on a thread about "Voxile"), user *Lichtso*: *"John Lin used to work on such an engine where all voxels stay axis and grid aligned, even in animations... But I think the project was abandoned in 2021."* Unchallenged.
- HN full-text search for "John Lin" since 2024-01-01 returns **exactly 3 comments** in two and a half years. The chatter has gone quiet.
- **May 2024, HN 40480022** (repost of *The Perfect Voxel Engine*) is the richest thread:
  - *truckerbill:* "It's a shame he disappeared for some reason, his stuff was crazy"
  - *TheRoque:* "maybe got hired and can't talk about it, who knows ¯\\_(ツ)_/¯" — **this is the origin of the "he got hired" theory. It is explicitly speculation with no source.**
  - *Crestwave:* he didn't abandon voxels, he *"shelved micro-voxels in favor of the traditional, chunkier voxel art style"* — citing the pinned comment on the Crystal Islands video. ⚠️ **That pinned comment dates to 2021, not recently.** Several search summaries misrepresent it as current news.
  - *bun_terminator:* "Even today when there's a voxel discussion on graphics programming communities — john lin comes up all the time."
- **2021, HN 28656883**, *junon*: *"one of the best voxel engines in existence rivaled only by Dennis Gustafsson's Teardown engine."* Reverence, not status.
- **NeoGAF** thread dead since 2021-01-11.
- **Beyond3D** thread *Raytraced Voxels? Voxlands* reportedly has a Feb 2024 discussion whose gist is that he hasn't shared anything since 2021 "other than assuring that it's still being worked on." ⚠️ **Could not fetch this page — guest read access disabled. Treat as unconfirmed secondhand.**

**Explicitly unverified:**

- Whether he was hired by a studio. Pure guesswork; no source.
- Whether he still works on it privately.
- The exact wording/source of the "shelved micro-voxels" claim. It reaches us via a 2023 blog commenter (Lonnie Cumberland: *"You mentioned that you have shelved it"*) and a 2024 HN commenter citing a 2021 pinned YouTube comment. **Do not report this as a direct statement without further sourcing.**
- His last X post beyond what guest view shows, and YouTube creator comment replies — historically where he answered technical questions. **YouTube comments are the highest-value unmined source** and would need a logged-in session.

---

## 4. Press

| Date | Outlet | Piece |
|---|---|---|
| Nov 2020 | PC Gamer (Malindy Hetfield) | "John Lin's beautiful physics sandbox gives me Minecraft vibes" |
| 2021-01-08 | PC Gamer (Natalie Clayton) | "John Lin's physics sandbox returns with the best water I've ever seen" |
| 2021-05 | cramgaming | Reproduces his Crystal Islands description verbatim, no added reporting |

Neither PC Gamer piece adds technical detail beyond paraphrasing his own video descriptions. The "best water I've ever seen" framing is Clayton's. Everything else is aggregator re-runs and YouTuber reaction videos.

---

## 5. Community reimplementations and inspired projects

**The premise that his repos seeded a wave of derivatives is not supported by evidence.** Verified negatives worth stating: `voxel.wiki`'s full source contains **zero** occurrences of "John Lin," "Lin20," "voxely," or "BinaryMeshFitting." Neither HN thread contains anyone claiming a derivative project — all comments are praise. The fork graphs of both engine repos show essentially one fork with its own commits (`PookieBokum/BinaryMeshFitting`), which never became a named project.

**Genuine credit, three items:**

1. **Tenebryo, "Voxel Raymarching"** (2021-01-13) — https://tenebryo.github.io/posts/2021-01-13-voxel-raymarching.html. SVDAG real-time path-traced renderer in Rust/Vulkano. Verbatim: *"I recently stumbled upon some short clips of John Lin's path traced voxel renderer... In this post, I hope to go over some components of the renderer I was inspired to engineer."* Strongest credit found — and it credits the *videos*, not the repos.
2. **`proton2/Manifold-dual-contouring-Java`** — 7★, **no license file**, last commit 2021-01-06. Description: *"Java version of Manifold Dual contouring author John Lin20 https://github.com/Lin20/isosurface."* A direct port.
3. **voxelenginetutorial.wiki/john-lin.html** — a tutorial site built around him (*"inspired by John Lin's pioneering work"*). Anonymous, SEO/AI-flavored. Real citation, weak project.

**Resource listings** (mention, not inspiration): `meshula/awesome-voxel` (203★), `curv3d/curv` research notes, `j-2k/GraphicsProgrammingRoadmap`, `Cewein/Neuro-Procedural-Generation` (cites his RNN post).

**Correction to a common assumption:** Gabe Rundlett's blog comment (2023-03-06) is real but is **not** an inspiration claim — it is admiration plus a hiring pitch: *"I want to make it clear that I'm not just trying to jump on the band wagon of your success. I have been working on a voxel project of my own for almost a year now..."* `gvox_engine` and gaberundlett.com contain no mention of Lin. **Do not describe gvox as Lin-derived.**

### 5.1 The actual landscape — verified alternatives

All figures verified 2026-08-18 (via github.com HTML + `commits.atom`; `api.github.com` was proxy-blocked for this pass).

| Project | Lang | License | ★ | Last commit | Form | Ray/path traced | Dynamic + physics | Embeddable |
|---|---|---|---|---|---|---|---|---|
| **Zylann/godot_voxel** | C++ | **MIT** | **3,846** | 2026-08-07 | **Godot module/GDExtension** | no | yes (Godot physics + fast blocky collision) | **yes** |
| **luanti-org/luanti** | C++ | LGPL-2.1 | 13,455 | 2026-08-16 | engine + platform | no | yes | partial |
| **shaoruu/voxelize** | Rust + TS | **MIT** | 663 | 2026-08-17 | **library (server + client)** | no | yes | **yes** |
| **GabeRundlett/gvox_engine** | C++/GLSL | MIT | 427 | 2026-08-02 | demo/app | **yes** (compute ray march, kajiya-derived GI, FSR2) | dynamic yes; rigid body unverified | no |
| **GabeRundlett/gvox** | C/C++ | MIT | 95 | 2026-08-15 | **format library** | n/a | n/a | **yes** (WASM, Rust/Zig bindings) |
| **DouglasDwyer/octo-release** ("Octo") | Rust→WASM/WebGPU | **none (binary-only)** | 396 | 2026-07-31 | demo, **archived** | **yes** | **yes**, incl. rigid body | no |
| **DavidWilliams81/cubiquity** | C++, zero-dep | **CC0-1.0** | 285 | 2026-07-17 | **library** | CPU PT, not realtime | edits yes, physics no | **yes** |
| **AdamYuan/SparseVoxelOctree** | C++/Vulkan | MIT | 682 | 2025-11-08 | demo | yes (SVO PT) | no (static) | no |
| **dust-engine/dust** | Rust/Bevy, Vulkan HW-RT | MPL-2.0 | 128 | 2026-08-11 | crates + demo | **yes** (hardware RT, DLSS-RR) | no | partial |
| **stijnherfst/BrickMap** | C++/CUDA | MIT | 112 | 2025-03-12 | demo | yes (realtime CUDA PT) | limited | no |
| **scallyw4g/bonsai** | C++ | WTFPL | 1,248 | 2026-08-14 | engine + editor | no | yes | partial |
| **splashdust/bevy_voxel_world** | Rust | MIT/Apache-2.0 | 341 | 2026-07-05 | library | no | yes | yes (Bevy) |
| **MissingDeadlines/iolite** | C/C++ + Lua | **none currently** | 287 | 2025-09-17 | engine + editor | claimed, unverified | claimed | claimed |
| **ephtracy/voxel-model** (.vox spec) | spec | **MIT (as of 2026-04-29)** | 1,368 | 2026-04-29 | spec | n/a | n/a | yes |
| **Voxlap** (Ken Silverman) | C/asm | **non-commercial, NOT open source** | 111 (mirror) | 2013-04-13 | engine | CPU raycast | yes | no |
| **pyranota/Venx** | Rust | MIT | **2, archived mirror** | 2024-06-15 | — | — | — | **dead end** |

**Flags and corrections:**

- **Voxlap's license is non-commercial.** Derivatives must be free and non-commercial, must credit "VOXLAP engine by Ken Silverman," and using it even as a test platform for a commercial game is prohibited without a license. Every GitHub mirror inherits this. **Do not treat mirrors as usable.**
- **Vercidium ≠ voxelbee.** `github.com/voxelbee` is a different person. Vercidium's actual engine (powering *Sector's Edge*) is closed, Patreon-gated, and **rasterization-based, not path traced** — only Apache-2.0 snippet extracts are public.
- **`github.com/gvox` is not Gabe Rundlett's** — unrelated account. The right one is `GabeRundlett/gvox`.
- **`jim-works/Wisphaven` is not Douglas Dwyer's** — unrelated Rust/Bevy GPL-3.0 game.
- **IOLITE** is the one to watch: the repo currently holds only a README saying *"This project is currently being restructured and will return as an open source project in 2026."* Old code on the `legacy` branch. **No license file today**, so its path-tracing/physics claims are unverified from source.

**Closed but well-documented — the best reading if you want to build this:**

- **Teardown** — Dennis Gustafsson's blog, https://blog.voxagon.se/. "From screen space to voxel space" (2018-10-17) is the key post; "The Spraycan" (2020-12-03) covers the 8-bit-palette material system; a 2024-12-29 summary describes the next engine's sparse 8×8×8 chunks tracked by a 3D bitmap; 2026-03-13 covers Teardown multiplayer. Joint talk with Gabe Rundlett, "Raytracing Voxels in Teardown and Beyond" (`youtube.com/watch?v=IM1Dr98f3xU`; venue/date unverified). Third-party frame breakdowns: acko.net/blog/teardown-frame-teardown/ and juandiegomontoya.github.io/teardown_breakdown.html. **Teardown is the shipped, commercially proven version of what Lin was demoing.**
- **Avoyd** (Enki Software) — "Implementing a GPU Voxel Octree Path Tracer" (2023-08-23), "Voxel GPU Rendering in Avoyd 0.21" (2024-04-26).
- **MagicaVoxel** — app closed, but the `.vox` spec is now MIT and is the de-facto interchange format across dust, gvox, IOLITE, and Octo.

### 5.2 Is anything permissive + embeddable + multiplayer + high-density?

**Nothing hits all four.** The gap is real and it is worth understanding before you plan around it:

- **voxelize** (MIT, active) is the only one embeddable *and* multiplayer out of the box — Rust server + Three.js client — but it is block-based and rasterized, nowhere near Lin density.
- **godot_voxel** (MIT, 3,846★, active) is the most mature embeddable module and has physics, but it is polygon-based, not ray traced, and ships **no built-in networking** — you get Godot's generic multiplayer, not voxel-aware replication.
- **gvox** (MIT) is embeddable and permissive but is format translation only — **no renderer**.
- **cubiquity** (CC0, zero-dependency C++) is the closest public thing to Lin's micro-voxel data structures — SVDAG/HashDAG with runtime edits, explicitly embeddable — but its path tracer is **offline**, and there is no physics and no networking. The author warns it is not production-ready.
- **Octo** has TCP multiplayer, rigid-body physics, realtime path tracing, and a WASM modding system — and ships as an **archived, binary-only release with no license**, development moved behind Patreon. Unusable as a dependency.

---

## 6. Honest assessment for a 10-day hackathon

### 6.1 What is flatly not reusable

- **The famous engine.** It does not exist as code you can obtain. This is not a licensing question or a "reach out to him" question — there is no artifact.
- **`BinaryMeshFitting` as a dependency.** Windows/MSVC-only, C++17, 2018-era, requires GLEW + GLFW + GLM + FastNoiseSIMD + a Vc install the README admits is unused, single `add_executable` with no library target, no tests, no CI, missing texture assets. Getting it to *build* is plausibly a 1–2 day task by itself, and what you'd have at the end is a smooth-terrain flythrough with no editing, no persistence, no physics, and no networking. **In a 10-day window this is a negative-value path.**
- **`isosurface`.** XNA 4.0 is dead; you'd port to MonoGame first. The author disclaims his own QEF solver.
- **Voxel-level physics, MLS-MPM fluids, path-traced GI, ray-traced audio, and voxel creature animation.** Each of these is individually a multi-month research project for a specialist. Lin spent roughly two years full-time on them and then rewrote from scratch. Any of them is out of scope for 10 days.
- **The "512 cubic detail" micro-voxel look.** Reproducing that means a custom Vulkan/compute path tracer with a bespoke acceleration structure that Lin explicitly never disclosed. There is no shortcut.

### 6.2 What is genuinely reusable — and it is ideas, not code

Three things from Lin's work transfer to Inspiral at essentially zero implementation cost:

**1. The format-agnostic data thesis (from *The Perfect Voxel Engine*).** This is the most valuable artifact he produced and it costs nothing to adopt. The argument: don't design the world around the renderer's preferred structure. Keep a bare-minimum common representation, tag attributes by name and type, and write conversion operators between representations. If Inspiral is a seed for a larger platform — and you said it is — this is directly load-bearing architecture advice: **define the world-state interface before you commit to a rendering backend**, so swapping Luanti's map format for something denser later is a conversion operator, not a rewrite. Read that post; it's ~20 minutes and it's the single highest-ROI item in this dossier.

**2. His SVO critique.** He is on record, at length, that sparse voxel octrees are "acceptable, not even great" at storage and rendering and bad at everything else — collision, GI, pathfinding, per-voxel attributes, dynamic objects. If anyone on your team proposes "we'll just use an SVO," this is the counterargument, from someone who tried. Saves you a bad week.

**3. "We don't rotate our voxels here, because we know better."** Keep everything axis-and-grid aligned, including animated and dynamic objects. This is also how Teardown works. It is the constraint that makes voxel physics and crisp rendering tractable at all, and it is free to adopt as a design rule on day one.

### 6.3 Concretely, for Inspiral

Given a 10-day window, Luanti as the base, and LLM-driven NPCs as the actual differentiator:

**Stay on Luanti.** LGPL-2.1, 13.4K★, pushed 2026-08-16, mature multiplayer, mature modding, and — critically — the NPC/LLM layer is where your demo's novelty lives. Nobody at a hackathon judging table will award "we ported to a path tracer." They will award "the world is alive."

**If you want visual differentiation, buy it cheaply rather than architecturally:**

- Higher *apparent* density via smaller node scale + texture/shader work inside Luanti, not a new renderer.
- **Ray-traced audio occlusion is Lin's most under-copied idea and the cheapest of his tricks** — his video on it got 101K views. In a world where NPCs talk, spatialized/occluded speech audio is thematically perfect for "Mind," reads instantly in a demo video, and is a small amount of code against a voxel grid you already have. This is my strongest specific recommendation from this research.
- Axis-aligned dynamic objects (per Lin's rule) for any destruction or moving-platform effects.

**If you seriously want to leave Luanti** — and I'd advise against it inside 10 days — the only two candidates that survive a licensing + maturity + embeddability screen are **`Zylann/godot_voxel`** (MIT, active, embeddable, physics; you'd write networking) and **`shaoruu/voxelize`** (MIT, active, multiplayer built-in, embeddable; block-based). Both are rasterized. Neither gets you Lin's look. Both are real, maintained, and permissively licensed, which is more than can be said for anything in the high-density path-traced tier.

**Do not** take a dependency on Octo (no license), Voxlap (non-commercial), IOLITE (no license file yet), or Venx (2★ archived mirror).

### 6.4 Reading list, ranked by ROI for your window

1. **The Perfect Voxel Engine** — https://voxely.net/blog/the-perfect-voxel-engine/ (architecture thesis; 20 min; directly applicable)
2. **Dennis Gustafsson, "From screen space to voxel space"** — https://blog.voxagon.se/ (the shipped, commercial version of these ideas)
3. **Object-Oriented ECS Design** — https://voxely.net/blog/object-oriented-entity-component-system-design/ (relevant if Inspiral's NPC layer needs an ECS)
4. **Tenebryo, Voxel Raymarching** — https://tenebryo.github.io/posts/2021-01-13-voxel-raymarching.html (the one real reimplementation attempt, with code-level detail)
5. **`BinaryMeshFitting` README + `DMCChunk.hpp`** — skim only, as a reference for DMC + mesh optimization if you ever need smooth terrain

---

## 7. Confidence and gaps

**High confidence** (verified via primary sources — GitHub REST API, raw READMEs, direct page fetches, HN Algolia full-text index):

- The complete 16-repo inventory with licenses, stars, and push dates
- `BinaryMeshFitting` and `PushingVoxelsForward` architecture — directory listings and filenames were read directly from the git trees API, not inferred
- The 14-video YouTube inventory with dates and view counts
- All direct quotes in §2.4
- The absence of company, trademark, store page, and press since Jan 2021
- The 2026-03-04 HN comment as the most recent community datapoint

**Medium confidence:**

- The "shelved micro-voxels for chunkier art style" claim — reaches us through two layers of intermediary and cites a 2021 pinned YouTube comment we could not load directly
- The Beyond3D Feb 2024 discussion — guest read access is disabled; summarized secondhand from a search index

**Low confidence / unknown:**

- Whether he was hired. **Pure speculation, no source.** Originates from one HN comment in May 2024 that explicitly flags itself as a guess.
- Whether he still develops privately
- Whether a private GitHub repo exists
- Contents of his ~1,560 X posts beyond the 5 visible in guest view — including the water-sim thread PC Gamer cited
- **YouTube creator comment replies — the highest-value unmined source.** This is historically where he answered technical questions in detail. Retrieving them needs a logged-in session and would likely surface real storage-scheme detail that exists nowhere else.

**Corrections to circulating misinformation, restated:**

- Video `i7vq-HY10hI` is **voxelbee's**, not Lin's
- Video `ZxfV7su168U` is **MishMash's**, not Lin's — and the "July 2026" date attached to it in search results is fabricated
- **There is no 2026 John Lin voxel content of any kind**
- `gvox` / Gabe Rundlett's work is **not** Lin-derived
- arXiv 2410.14128 "Hybrid Voxel Formats for Efficient Ray Tracing" does **not** cite Lin — that citation, which appears in some summaries, does not exist
- Search-engine summarizers repeatedly presented 2020–21 material as current 2026 activity during this research. All recency claims here rest on primary fetches.

---

## Sources

**Primary — John Lin**

- [github.com/Lin20](https://github.com/Lin20) and the GitHub REST API (`api.github.com/users/Lin20`, `/repos`, `/git/trees`, `/commits`)
- [Lin20/BinaryMeshFitting](https://github.com/Lin20/BinaryMeshFitting) · [Lin20/PushingVoxelsForward](https://github.com/Lin20/PushingVoxelsForward) · [Lin20/isosurface](https://github.com/Lin20/isosurface)
- [The Perfect Voxel Engine](https://voxely.net/blog/the-perfect-voxel-engine/) (2021-09-18)
- [Object-Oriented Entity-Component-System Design](https://voxely.net/blog/object-oriented-entity-component-system-design/) (2021-07-27)
- [Using a RNN for 2D Tile Map Synthesis](https://voxely.net/blog/using-a-rnn-for-2d-tile-map-synthesis/) (2023-08-21)
- [YouTube channel UCM2RhfMLoLqG24e_DYgTQeA](https://www.youtube.com/channel/UCM2RhfMLoLqG24e_DYgTQeA) — video descriptions quoted throughout §2.4
- [x.com/ProgrammerLin](https://x.com/ProgrammerLin)

**Press and community**

- [PC Gamer — "John Lin's physics sandbox returns with the best water I've ever seen"](https://www.pcgamer.com/john-lins-physics-sandbox-returns-with-the-best-water-ive-ever-seen/) (2021-01-08)
- [PC Gamer — "John Lin's beautiful physics sandbox gives me Minecraft vibes"](https://www.pcgamer.com/john-lins-beautiful-physics-sandbox-gives-me-minecraft-vibes/) (Nov 2020)
- [HN 47245143](https://news.ycombinator.com/item?id=47245143) (2026-03-04, "abandoned in 2021")
- [HN 40480022](https://news.ycombinator.com/item?id=40480022) (May 2024, richest discussion)
- [HN 28656883](https://news.ycombinator.com/item?id=28656883) (2021)
- [NeoGAF thread](https://www.neogaf.com/threads/introducing-john-lins-sandbox-path-traced-voxel-project.1535795/) (dead since 2021-01-11)
- [cramgaming — Crystal Islands](https://cramgaming.com/new-voxel-engine-reveal-crystal-islands-experiment-57455/)

**Reimplementations and alternatives**

- [Tenebryo — Voxel Raymarching](https://tenebryo.github.io/posts/2021-01-13-voxel-raymarching.html)
- [proton2/Manifold-dual-contouring-Java](https://github.com/proton2/Manifold-dual-contouring-Java)
- [Zylann/godot_voxel](https://github.com/Zylann/godot_voxel) · [shaoruu/voxelize](https://github.com/shaoruu/voxelize) · [luanti-org/luanti](https://github.com/luanti-org/luanti)
- [GabeRundlett/gvox_engine](https://github.com/GabeRundlett/gvox_engine) · [GabeRundlett/gvox](https://github.com/GabeRundlett/gvox)
- [DouglasDwyer/octo-release](https://github.com/DouglasDwyer/octo-release) · [DavidWilliams81/cubiquity](https://github.com/DavidWilliams81/cubiquity)
- [AdamYuan/SparseVoxelOctree](https://github.com/AdamYuan/SparseVoxelOctree) · [dust-engine/dust](https://github.com/dust-engine/dust) · [stijnherfst/BrickMap](https://github.com/stijnherfst/BrickMap)
- [Dennis Gustafsson / Teardown dev blog](https://blog.voxagon.se/)
- [Teardown frame breakdown (acko.net)](https://acko.net/blog/teardown-frame-teardown/) · [Teardown breakdown (Juan Diego Montoya)](https://juandiegomontoya.github.io/teardown_breakdown.html)
- [voxel.wiki projects list](https://voxel.wiki/wiki/projects/)
