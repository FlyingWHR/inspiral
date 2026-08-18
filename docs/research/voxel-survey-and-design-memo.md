# High-Density Voxel Worlds: A Survey, a Synthesis, and a Design Memo for *Habitat / Inspiral: Worlds*

**Prepared 18 August 2026.** Research method: web search and direct fetch of primary sources (developer blogs, GDC/GPC slide decks, GitHub, official docs, ContentDB, company announcements).

**Confidence tags used throughout:**

- **[unconfirmed]** — I could not verify this. Do not repeat it on stage.
- **[disputed]** — sources conflict and I could not resolve them.
- **[inference]** — my own reasoning from verified facts, not a sourced claim.

**Read order if you're short on time:** Part 0 (the calendar), then Part 3.1 (the recommendation), then Part 3.3 (what to cut), then **Part 3.5 — which contains the two highest-value single actions in this document** (the split-screen proof and the citation check).

---

## Part 0 — The hackathon, verified

Read this first, because "ten days" is not ten build days.

**Creative Minds Jam #1** — The Sandbox × Animoca Brands, Hong Kong. Verified from the [primary Animoca announcement, 23 July 2026](https://www.animocabrands.com/announcement/the-sandbox-and-animoca-brands-launch-creative-minds-jam-1-hong-kong-usd10000-agentic-ai-competition):

| Item | Value |
|---|---|
| Theme | **"Build What Creators Need Next"** |
| Registration opened | 28 July 2026 |
| HK in-person kick-off | 30 July 2026 |
| **Submission deadline** | **28 August 2026** |
| Showcase + results | September 2026 |
| Prize pool | US$10,000 |
| Judging criteria | Creativity, technical execution, UX, **innovative use of agentic AI** |
| Judges | Yat Siu, Robby Yung, Sébastien Borget, Mohamed Ezeldin (Animoca Labs) |
| Registration | [dorahacks.io/hackathon/creativeminds](https://dorahacks.io/hackathon/creativeminds/detail) · [creativemindsjam.com](https://creativemindsjam.com/) |

**The binding rule, verbatim from the announcement:** *"Participants will be free to use any tools, provided that Minds agents are an integral part to their product submissions."*

**The calendar, spelled out.** Today is Tuesday 18 August. The deadline is Friday 28 August — ten calendar days. But the last two days are capture and edit, and you want submission buffer, so:

> **Day 1 = Tue 18 Aug · Day 8 = Tue 25 Aug · Wed 26 – Fri 28 Aug held as submission buffer.**
>
> That is **eight build days, of which the last two are video production. Six days of actual building.** Plan against six.

**Two things to verify yourself today, because I could not:**

- **The closing *hour* on 28 August.** The announcement gives a date, not a time. DoraHacks deadlines are usually timezone-specific (the sibling VibeBlitz jam closed at 23:59 SGT).
- **The required submission format** — video length, demo link, repo, written brief. I found no published spec. **Everything I recommend below assumes a ~60-second video because that's your stated plan, not because the jam requires one.** If the jam permits three minutes, several of my cuts get easier. Check before you cut. **[unconfirmed]**

Downstream context: winners are *"considered for"* the [Minds Investment Programme](https://build.hellominds.ai/program), announced 5 May 2026, **up to US$10M aggregate**, subject to investment committee approval. **[inference]** I read that as making the jam a de facto qualifying round for investment rather than a $10k competition, which argues for optimising toward *investable platform thesis* over *most impressive toy*. That's my reading, not something the announcement says — but it drives my advice in Part 3.3, so weigh it accordingly.

Precedent that this format works and Animoca amplifies winners: [vibecode.game by YGG announced VibeBlitz jam winners on 11 August 2026](https://www.animocabrands.com/announcement/vibeblitz-jam-ygg-minds-animoca-brands), run with Minds.

**One thing I could not verify: a public Minds developer API/REST specification.** The DoraHacks detail page returned empty to fetchers and I found no published SDK reference. You say you've verified the constraints (no mind-to-mind Circles via the Builder API; free tier of 3 Minds), so you're ahead of me here — but if any part of your architecture assumes an endpoint you haven't personally called yet, call it today. **[unconfirmed]**

**One platform fact worth knowing:** you cannot ship an LLM-driven NPC inside **The Sandbox Game Maker** today. Game Maker is explicitly *"a no-code software with a drag-and-drop interface"* ([docs](https://docs.sandbox.game/en/creator/game-maker/docs)); its complete NPC surface is eight fixed behaviours (Citizen, Farmer, Healer, Melee Enemy, Predator, Prey, Soldier, Friendly NPC) plus an `Asker` dialogue trigger. There is no HTTP client, no script hook, no server-side mod surface anywhere in the documentation set. **The Sandbox Studio** — the new AI-first, code-accessible engine — is whitelisted alpha (12,000+ applications, ~30 alpha creators), moving to broader beta in **August 2026** with a game jam, and targeting **public launch Q4 2026**. Your "Sandbox next" roadmap line is defensible, but *date it to Studio's public launch and say so on stage*. It signals you read the platform instead of name-dropping it.

---

## Part 1 — Survey

### 1.0 Teardown, in depth (the reference point)

You said Teardown is the perfect example. You're right about the look, and one of your four caveats is now factually wrong, so let's do this properly.

#### Voxel scale — decimetre, and that's the whole point

**The working figure is 10 cm per voxel** (10 voxels = 1 m). Source: community documentation ([Teardown Wiki](https://teardown.fandom.com/wiki/Voxels)) — ***not* a first-party statement. [unconfirmed]** I use it throughout this document because it's the only concrete number available and it is consistent with the developer's own level-size constraint, but flag it as community-sourced if anyone presses you.

The consistency check: Gustafsson states levels are capped at **~400 m** because of an AMD 3D-texture size limit ([Teardown design notes](https://blog.voxagon.se/2020/11/05/teardown-design-notes.html)). That limit binds on the **global occlusion volume**, not on per-object textures. 2048 texels × 2 voxels/texel (the 2×2×2 bit-packing) × 0.1 m = 409.6 m. **[inference]** That's consistent with a 10 cm voxel — though note the actual captured frames are 1252 and 1752 texels wide, well under the ceiling, so it's corroboration rather than proof.

A related figure appears in [From screen space to voxel space](https://blog.voxagon.se/2018/10/17/from-screen-space-to-voxel-space.html): *5 cm voxel texture resolution, 10 cm octree cells.* That post predates the shipped renderer by two years and I could not reconcile it with the shipped engine's "one texel per voxel" surface-grain projection described below. **[disputed]** Treat 10 cm as the number and don't get drawn into the 5 cm figure.

Object authoring is capped at **256×256×256 voxels** — the MagicaVoxel limit ([official modding docs](https://get-teardown.readthedocs.io/en/latest/mods/creating-your-own-assets.html)) — which at 10 cm is a 25.6 m cube. Teardown's modding docs recommend ~128³ for most props.

**Why decimetre is the sweet spot.** At 10 cm, a doorframe is one voxel thick, a car is ~40 voxels long, a human is ~18 voxels tall. That is *coarse enough that every voxel is a decision* and *fine enough that a wall reads as a wall rather than as a Minecraft block.* Compare:

- **~1 m (Ace of Spades, Minecraft, Luanti):** the grid is the information channel. You can read an enemy's tunnel from across the map. But nothing reads as *architecture* — it reads as *blocks arranged into architecture*.
- **~10 cm (Teardown):** the grid is a *surface texture*. At 1–20 m viewing distance it reads as material — chipped concrete, corrugated steel — rather than as a data structure. Objects have believable mass.
- **~1 cm and below (John Lin, Atomontage):** the grid vanishes entirely. You have paid enormously for density and bought yourself *photorealism you now have to art-direct*, which is a harder and more expensive problem than stylisation. Atomontage's own co-founder concedes: *"It's not as slick as Fortnite."*

The trap at sub-centimetre is that density stops being a style and becomes noise. Once the viewer can't perceive individual voxels, they judge your scene against photography, and you lose. Teardown's density is deliberately just above the noise floor.

#### The renderer is built around the density being *low*

This is the load-bearing technical fact and it inverts the usual assumption. Teardown does not raytrace *despite* being voxels; it raytraces *because* voxels at decimetre scale are cheap to trace.

Verified from [Juan Diego Montoya's frame breakdown](https://juandiegomontoya.github.io/teardown_breakdown.html) and [Steven Wittens' teardown of Teardown](https://acko.net/blog/teardown-frame-teardown/):

- **API: OpenGL 3.3.** No compute shaders. No hardware ray tracing. Everything happens in fragment shaders. The hardware floor is a GTX 1070-class card.
- **Each object is drawn as 36 vertices — its oriented bounding box** — with a unique 3D texture bound. A modified Amanatides–Woo voxel DDA marches inside the fragment shader, using 2 mip levels above base (3 total) to skip empty 2×2×2 and 4×4×4 blocks. There is no mesh. There is no triangle geometry for the world.
- **World occlusion volume:** 1252×128×1252 texels in one captured frame (Marina: 1752×100×1500), each texel packing **2×2×2 one-bit voxels** → effectively a 2504×256×2504 grid, 200–262 MB.
- The scene is **thousands of small volumes, not one big grid**. Gustafsson: *"Instead of one big volume of billions of voxels, I have thousands of smaller volumes."* Each is internally axis-aligned but freely posed in world space.

**There is no global illumination.** Confirmed directly by Gustafsson, [80.lv interview, 17 March 2026](https://80.lv/articles/teardown-developer-breaks-down-multiplayer-and-voxel-destruction-tech): *"Teardown actually doesn't implement global illumination (light does not bounce off surfaces), but we use raytracing for ambient occlusion, soft shadows and specular occlusion... A lot of the design choices... is because it was made before hardware raytracing became available."*

The lighting budget is astonishingly small: **2 cosine-weighted hemisphere rays per pixel** for ambient (max 24 units), **1 jittered ray** for sun shadow, **1 shadow ray to a random point** on each area light emitter. Everything is area lights — sphere, capsule, cone, rect, textured screen. Volumetrics at quarter resolution. Then it denoises hard: diffuse irradiance is demodulated from albedo, 12-tap Poisson bilateral blur, reprojected, blended 50/50 with the previous frame, then re-multiplied by albedo. Specular gets temporal-only denoising (spatial blur would kill it). Then TAA on top. **Four separate temporal reprojections per frame.**

#### The single most transferable sentence in Gustafsson's entire blog

> *"the voxel grid becomes pretty noticeable with sharp shadows and particularly so with light coming in at a sharp angle. However, since we are now raytracing the shadows, it's really easy to **make soft shadows by just jittering the light position. This will effectively hide artefacts from the voxel grid**."*
> — [From screen space to voxel space](https://blog.voxagon.se/2018/10/17/from-screen-space-to-voxel-space.html)

**Soft shadows are the thing that makes voxels look expensive.** Not density. Not ray tracing. Soft shadows plus ambient occlusion. You can buy both in any modern engine with a checkbox. This is the sentence to tape to your monitor.

#### Art direction — what actually makes the screenshots

Ranked by how much of the look each contributes, and how cheaply you can steal it:

1. **Fake bevels via normal-buffer blur.** After the G-buffer, near-camera normals are blurred with a golden-ratio spiral kernel, gated by depth similarity. Every cube edge catches a specular roll-off. This is the single biggest reason Teardown doesn't look like Minecraft. *(Not directly available elsewhere; the substitute is aggressive SSAO + soft shadows.)*
2. **Soft shadows from a low sun angle.** Per the quote above.
3. **Palette discipline.** 8-bit palette indices; each palette row stores colour + roughness + emissiveness + reflectivity + physical material type ([The Spraycan](https://blog.voxagon.se/2020/12/03/spraycan.html)). Gustafsson: *"Most objects in Teardown actually only use a handful of materials."* After spray-can reservations, **28 usable palette entries**. Twenty-eight colours for an entire game.
4. **Sub-voxel surface grain.** A global blend map + albedo map + normal map projected onto voxels, **one texel per voxel**, adding faint grime to otherwise flat single-colour faces. Breaks up large uniform surfaces without breaking the palette.
5. **Blue-noise dithered screen-door transparency resolved by TAA.** Glass, smoke, rain, snow, third-person ghosting all render opaque with stochastic pixel discard. Cost: visible ghost trails when strafing past windows — the one bad artefact.
6. **Volumetric smoke from 4 triangles.** Each particle is a hollow square pyramid facing the viewer with interpolated normals, and every other pixel's normal is mirrored across the view vector. Billboards that read as volume.
7. **Procedural puddles from the volumetric shadow map.** Puddles vanish under anything you hold over them and appear on the held object instead. Sells the world as simulated rather than dressed.
8. **Post:** auto-exposure via a 256×256 luminance mip chain sampled in an X pattern at mip 6, α=0.05; bloom downsampled to ~20×11 with separable 7×7 gaussians (sharp peak, long tail); tonemap `1 - exp(-color)`, gamma 2.2; bokeh DOF via a single-pass spiral filter; lens dirt on the sun only; vehicle silhouette outlines via an offscreen white pass + edge detect.

**Object scale relative to voxel size is doing quiet work.** A first-person camera at 1–20 m from decimetre voxels puts the grid right at the threshold of legibility. Gustafsson also notes a level-design rule worth stealing: *"we also wanted to keep the level straight to have the goal direction consistently aligned with the sun"* — i.e. **compose so the sun rakes along your camera move.**

**One correction to a claim you'll see repeated:** heavy colour grading is *not* part of Teardown's documented look. Tonemapping, colour grading, exposure and bloom appear in the frame breakdowns but Gustafsson never writes about grading as an art choice. "Teardown looks like that because of the grade" is inference, not sourced.

#### The honest caveats

You listed four. **One is now factually wrong, one needs a caveat, two are correct.**

- **Closed source** — correct. No public source release.
- **Engine not licensable** — no public licensing programme exists and none has been announced, so treat it as unavailable. But I found no explicit developer statement refusing to license it either. **[unconfirmed as a positive claim]** It doesn't matter for you; the practical answer is the same.
- **"Single-player by design, community multiplayer mods only"** — **this is now wrong.** Official online multiplayer shipped **12 March 2026**, free update, PC, **up to 12 players**, campaign co-op plus sandbox plus group modes; consoles later in 2026. Do not say this on stage.
- **"Its entire mechanical premise is destruction, which your design does not use at all"** — correct, and it's the most important caveat in the list. See Part 3.1.

**What multiplayer cost, because it's the best available data point on destruction+network:**
Read [the March 2026 devblog](https://blog.voxagon.se/2026/03/13/teardown-multiplayer.html) if you read nothing else. Summary: a 2021 naive prototype (send altered voxel data) *"used enormous amounts of bandwidth and completely choked the connection"* and was abandoned. The 2022 redesign rewrote the entire destruction path **in fixed-point integer maths** to emit a deterministic command stream over a reliable channel, with everything non-structural on unreliable state sync inside a **~1 Mbit/s per-client budget** and a per-client priority queue. No dedicated servers — the host is the server. Join-in-progress replays the command buffer because full scene serialisation is 30–50 MB+. The merge into the shipped game took **~3 months plus over a year of weekly manual merges.** Gustafsson: *"To this day, I'm still unsure if it was the right decision to merge."* And: *"The multiplayer implementation in Teardown isn't particularly elegant; it's just a lot of hard work and a lot of code."*

**Roughly five years, on a shipped and profitable title, to reach twelve players.**

**Team and outcome:** Tuxedo Labs, founded 2019 in Malmö, ~6 people. Nearly a full year of failed design prototypes *before* Early Access, because no conventional objective survives full destructibility. Steam EA October 2020; 1.0 on 21 April 2022. Over 1M copies during Early Access; ~2.5M players after the November 2023 console ports. *(Aggregator estimates of 5–11M lifetime are modelled, not reported — **[unconfirmed]**.)* Acquired by Saber/Embracer August 2022, later moved under Coffee Stain.

#### The separation you may be conflating

**Teardown's appeal decomposes into three things, and they have wildly different prices:**

| Component | What it costs you | Do you need it? |
|---|---|---|
| **Art direction** — palette discipline, soft shadows, low sun, AO, chunky silhouettes, bloom, DOF | **~2 days, free assets** | **Yes. Buy it.** |
| **Destruction physics** — connected-component fracture, voxel-vs-voxel collision, the two-phase heist loop it forced into existence | ~1 year of design failure + years of engineering | **No. Your design has no destruction verb at all.** |
| **Voxel density as a rendering technology** — the DDA fragment shader, the octree, the four temporal reprojections | Multiple engineer-years, and it exists to serve the destruction | **No. Absolutely not.** |

You can have the first cheaply and you need neither of the others. **The look is overwhelmingly art direction, not density.** Ace of Spades has voxels a full order of magnitude coarser and still looks coherent; Atomontage has voxels two orders finer and looks worse. Density is not the variable.

---

### 1.1 Douglas Dwyer — "Octo"

Solo developer, Rust + WebGPU + WASM, runs native and in-browser. Voxel ray marching in compute shaders, explicitly targeting three tiers: playable on integrated GPUs, playable in a browser, high-quality on discrete desktop. He built and compared a brickmap, an octree, *and* an SVDAG. Real-time path-traced indirect lighting (AO, shadows, emissive voxels) since v0.7.0. Custom rigid-body physics with connected-component detection. WASM-based runtime mod loading. [github.com/DouglasDwyer/octo-release](https://github.com/DouglasDwyer/octo-release), 395★.

**What density buys:** left-click destroy, right-click build, import arbitrary .vox at arbitrary scale, fully editable terrain at large scale with correct lighting, in a browser tab, on an iGPU. 2026 added per-voxel materials and fracturing.

**Art direction:** path-traced AO + emissive voxels does all the readability work. Note the deliberate inversion versus Teardown — Dwyer paid for GI and gave up Teardown's OpenGL-3.3 hardware floor; Teardown skipped GI and kept a 2016-GPU floor.

**What it cost — this is the useful part.** The changelog is an honest ledger. Version **0.5.0: *"Removed all voxel-related code from the engine."*** A full rewrite from rasterisation onto ray-marched structures. The README's "to be re-added" list names what the rewrite destroyed: **transparent voxel objects, octree-accelerated Perlin terrain generation, and peer-to-peer networking (web + desktop)**. Multiplayer today is TCP, desktop-only. Roughly four years of solo devlogs to reach a free tech demo. Two full engine rewrites by one person.

**2025–26:** [Devlog #25 (Oct 2025)](https://www.youtube.com/watch?v=pY7Y2pSCnGo) — 2D physics testbed with speculative contacts and projected Gauss–Seidel. [Devlog #26 (May 2026)](https://www.youtube.com/watch?v=R9bror0oqR0) — rigid-body overhaul, voxel materials, fracturing, Temporal Gauss–Seidel.

### 1.2 John Lin

The most visually famous micro-voxel demos of 2020–21: volumetric water that flows, splashes, sprays and refracts; voxel forests; volumetric clouds and smoke; destruction. [PC Gamer, Jan 2021](https://www.pcgamer.com/john-lins-physics-sandbox-returns-with-the-best-water-ive-ever-seen/): *"Lin's fluids flow and splash and spray remarkably, refracting light and filling spaces just as you'd expect."*

**What density bought, and immediately cost.** The water is *fully volumetric — simulated as fluid, not shaded as a surface* — which is why it fills irregular cavities. But at the time of coverage it **only interacted with terrain, not players or objects**, and because all water spawned from limitless faucets, the world would eventually submerge itself. His stated next problem was implementing an evaporation/rainfall cycle *just to conserve mass*. That is the cost profile of simulation-over-fakery in one sentence: an honest sim needs an entire hydrological cycle before it can be a game system.

**His essay is the best skeptical document in this whole space** — ["The Perfect Voxel Engine," Sept 2021](https://voxely.net/blog/the-perfect-voxel-engine/), written by an insider:

> *"There's no commercially available, general-purpose, widely-used voxel engine which games are built on. The term '(micro) voxel engine' is basically synonymous with vaporware. We see jaw-dropping showcases that are sometimes accompanied by hyperbolic claims ('UNLIMITED DETAIL') and then radio silence."*

> *"As it turns out for sparse voxel octrees, storage and rendering are the only things they are acceptable (not even great) at."*

His diagnosis: developers design around rendering, then discover the format is hostile to collision, GI, pathfinding, per-voxel attribute extension, and dynamic objects. His prescribed fix was a modular Allocation → Tagging → Conversion pipeline with no single canonical format.

**The promised follow-up post on the rendering architecture was never published.** The blog's last post is August 2023. **His 2025–26 status is unverified** — no evidence of any 2026 release or milestone. **[unconfirmed]** The irony is complete: he correctly identified that the renderer is the small part of the problem, and then the rest of the problem consumed him.

### 1.3 Atomontage

Branislav Siles (demoscene background, ~20 years of personal R&D) + Daniel Tabar. Company formed ~2017. "Microvoxels" with sub-millimetre resolution claimed for close-up assets. Tabar's framing: *"What if those LEGO-like blocks were so small that it almost becomes like virtual clay?"*

The claimed breakthroughs are **compression and streaming, not rendering**: content lives in the cloud as a "Montage," streams to the client only at the LOD your viewpoint needs, caches, and **renders locally** — explicitly not pixel-streaming. Tabar: *"we don't need a GPU on the server side, which is a big deal. Stadia was a money pit."* Worlds are persistent — craters, bullet holes, footprints accumulate across a server's lifetime.

**The pivot chain is the story:** microvoxel game engine → cloud "JPEG of 3D" sharing platform (open beta ~Nov 2021) → **"Virtual Matter,"** a Roblox-successor UGC platform with Lua scripting, mobile/browser/XR clients, and an AI image→3D import path. Non-game validation is real: Karolinska Institute used it for ~20 GB light-sheet microscopy datasets.

**Status 2026: alive, not folded.** Active on Crunchbase/Tracxn/PitchBook; presented at Nordic Game May 2025; Tabar on a podcast March 2026. Team ~15. Funding figures conflict badly across sources ($1.2M / $1.95M / $3.5M / $4.5M / $5.53M all appear) — best defensible statement is **roughly $4–5.5M total, all angel/seed, no institutional Series B**. **[amounts unconfirmed]**

**Cost:** ~20 years of one person's R&D plus ~9 years of company time, ~15 people, **zero shipped game**, three strategic repositionings. Tabar's own list of the fallen is the market signal: *"Even very smart people like Ken Silverman... John Carmack, Jon Olick, they spent years trying to make these cubes small enough, and they gave up at some point, pretty much all of them."*

**The one idea worth stealing:** persistent world-state as visual language. Accumulated craters, footprints, and bullet holes as a legible record of what happened in a space. That is *directly* applicable to you — see Part 3.5.

### 1.4 Voxel Quest

Gavan Woolery, solo. Kickstarter Oct–Nov 2014: **$35,213 from 1,561 backers** against a $30,000 goal. Last update November 2016.

**Three rendering generations, and the lesson is in the order:**

1. **Isometric, fixed-camera, GPU-powered** (2013–14). Chunks rendered once and cached as sprites, then composited. Woolery's own assessment: *"Arguably the isometric rendering looked the best of all the methods."*
2. Intermediate iteration.
3. **Free-camera, ray-marched/SDF hybrid** (2015). Heavy specular ("everything covered in oil," per commenters — Woolery agreed and blamed switching from fake to real specular), and a very short draw distance he attributed to *data loading on the main thread*, not rendering.

**The art-direction lesson, which is the clearest in this whole survey:** the fixed isometric camera was doing the heavy lifting. A locked camera lets you cache lighting into sprites, which buys far more per-voxel shading budget than a free camera can afford, and gives a stable silhouette read at a known screen scale. When he went free-camera to prove the tech wasn't "an unpractical hack," he lost both the performance and the charm. **Trade camera freedom for voxel readability deliberately, not accidentally.**

**Why it stalled.** He diagnosed it himself a year before the end: *"the point here is not just to make a game... but to make a unique engine"* and *"I can't build a business off an engine alone, and I need to dogfood the engine to ensure necessary features."* The top Hacker News comment is the epitaph: *"it's hard to be excited about the game, because there doesn't seem to be one."* He spent 2015–16 soliciting game-design suggestions from the internet rather than having a design. Mid-2016 he ran out of money, **refunded Kickstarter backers, investors, patrons and preorders**, took a job, and MIT-licensed every engine iteration.

### 1.5 Ace of Spades

**0.x "Classic"** (Ben Aksoy, 2011–12), built on Ken Silverman's **Voxlap**. Maps are **512×512×64 voxels** in a column-based VXL format distinguishing *open* (air), *solid* (invisible interior), and *coloured* (visible surface) voxels — **only the visible skin carries colour**, so edits transmit as small deltas. 16v16 CTF. Kotaku "Best Indie Games of 2011." **2.5M installs and ~550,000 MAU as of November 2012.**

**Jagex 1.0** (Dec 2012). Jagex acquired the game; Aksoy agreed *"due to his critical financial state,"* was hired, and left within months. Jagex handed the code to work-for-hire studio **Blitz Games with a reported deadline of roughly two months** to hit Christmas. Released 12 December 2012 at $9.99 on a new engine. **Metacritic: "generally unfavorable."** *(The commonly cited "November 2012, eight weeks" handover doesn't fit a 12 December ship date; the handover was probably earlier. **[disputed]**)* Delisted 3 April 2018; **1 March 2019 Jagex declined to open-source it**, citing *"potential technical, legal and licensing implications"*; servers off 6 March 2019.

**Why the community forked:** not a licensing dispute — a quality judgment. 1.0 was *"a new game in the same genre, not the original Ace of Spades."* Because the code was never released, the community **re-implemented the client**: [OpenSpades](https://github.com/yvt/openspades) (GPL-3.0, 2,167 commits, 1.2k★, protocol-compatible with 0.75 servers) and BetterSpades (targets GL/GLES 1.1 for low-end hardware).

**What destruction bought:** the cleanest destruction mechanic in this document. **The shovel and the block are primary tactical verbs, on par with the rifle.** Tunnel under a chokepoint, bridge a river to open a lane, tower up for a sightline. Crucially the voxel is *large* — roughly 1 m relative to the player — which makes every edit **legible to other players at a glance**. That's a design property small voxels lose.

**What it cost:** maps degrade monotonically over a round with no restoration mechanic; the entire wire protocol is frozen at 0.75 because that's the only compatibility surface that exists; blocks obey simple support rules rather than physics simulation (which is *why* it ran 32 players in 2011); 64 voxels of vertical budget caps the most interesting axis. **The free 2011 prototype remains the version people actually play in 2026.**

### 1.6 Vintage Story

**Correction to a common premise: Vintage Story does *not* have higher terrain voxel resolution than Minecraft.** A VS block is the same ~1 m unit. Chunks are **32×32×32** (`ChunkSize = 32` in [GlobalConstants.cs](https://raw.githubusercontent.com/anegostudios/vsapi/master/Config/GlobalConstants.cs)) — a streaming/meshing decision, not a density one. Block textures are **32×32 px** vs Minecraft's 16×16.

All the extra density is **opt-in and localised**: a **16×16×16 chisel sub-grid** (4,096 sub-voxels per block), gated behind `/worldconfig microblockChiseling [off|stonewood|all]` *because it isn't free* — it multiplies mesh complexity.

**Density buys verbs, not fidelity.** One voxel grid, three escalating crafting minigames, one new rule per tier, zero new UI paradigms:

- **Knapping** — max 10×10, single layer, **subtract only**. The game blocks removal of required voxels.
- **Clay forming** — max 16×16 × 16 layers, **additive and subtractive**, layer by layer. 1×1/2×2/3×3 brushes plus "copy previous layer." Costs in clay units (bowl 1, crucible 2, storage vessel 35, clay oven 69).
- **Smithing** — max 16×16 × 6 high. **1 ingot = 42 voxels, 1 plate = 81.** Heavy Hit (flatten/spread), Upset (displace laterally at edges), Split (permanently delete 1 voxel). **Mass conservation.**

That's the model: subtract-only → add/subtract in layers → displace mass with conservation. Each tier teaches the next. This is the single best example in the survey of *density as mechanic* on a tiny budget.

**Art/cost:** vanilla shader stack includes block+ambient bloom, god rays, dynamic sun shadows, **SSAO**, and 32-block coloured lights. Desaturated ochre/slate palette. ~10.5 years of development (started Feb 2016, still Early Access, latest 1.22.1 April 2026). **Team ~22, not single-digit** — in 2025 they hired ex-Hypixel devs post-cancellation for "Project Glint." €20, no discounts ever, own storefront, deliberately not on Steam (30% cut *"unreasonably high"*). The only primary sales datum is Tyron Madlener in Nov 2020: *"As of today, Vintage Story has sold over 20,000 times."* Any current figure is **[unconfirmed]**.

### 1.7 Veloren

Two-scale voxels: *"One landscape block is 11x11x11 small scale voxels big. … A character model is around 22 small scale voxels tall"* ([book.veloren.net](https://book.veloren.net/contributors/artists/voxel-models.html)) — 1,331 small voxels per landscape block. Terrain chunks 32×32 horizontal, full-height columns.

**The transferable idea:** the pipeline is MagicaVoxel `.vox` + `.ron`, and **the palette index is semantic data** — it doubles as an enforced style guide across 45+ volunteer artists. That's how you get visual coherence out of a distributed team with no art director. Consider whether you want a version of that.

**Density buys content breadth, not interaction depth.** *"Veloren is primarily an action-adventure RPG rather than a sandbox building game."* `/build` is an admin command; world changes are **not persisted by default**; terrain persistence is an experimental compile flag the docs call *"a stop-gap."*

**Cost:** 8 years, v0.18 (Jan 2026), cadence gone from quarterly to annual. **$19,238 raised all-time, annual budget $2,563** (OpenCollective) against likely 100+ person-years of volunteer labour. Code is alive (commits 16 Aug 2026) but communications are dead — latest devblog published 21 Nov 2025 covering *May 2025*. Do not repeat the "weekly devblog" claim.

### 1.8 Enshrouded

**Status as of today: still Early Access.** 1.0 scheduled **15 October 2026** (PC + PS5), Xbox spring 2027. It has slipped four times.

Verified from GPC 2025 slide decks: **voxel edge 0.5 m**; **world 10 km × 10 km × 4 km**. Engine is "Holistic," in-house C++, Vulkan-only on PC, and **not new** — Lukas Feller: *"it has been used in all previous projects at Portal Knights, but it is under continuous development"*; Jakub Kolesik: *"we have our custom tech since 2005 and shipped 38 games on all platforms."* Voxels store albedo, roughness, specularity and emissive, with the normal derived from the isosurface. GI moved off Vulkan RT onto their own SDF rays (32³ cascade grid, 12 cascades, ray budget 100k/250k/500k). The meshing algorithm is **unpublished** — no source names marching cubes, dual contouring or transvoxel. **[unconfirmed]**

**Density buys a shape catalogue with mixed granularity:** 0.5 m (one voxel) → 1 m → 2 m → 4 m. Frame with 4 m walls, ornament at 0.5 m. Elements **interpenetrate instead of snapping**. Subtraction is first-class — cut a window into a finished wall. Terrain and buildings are the same field, so you dig anywhere. No structural-integrity nag: *"you can have your floating castle in the sky."*

**Important negative finding: there is no free-form sculpting brush for players.** The arbitrary-mesh voxel brush is an *internal editor tool*. Players stamp shapes. Art Director Jonas Drinnenberg: *"We can import and use any mesh in any scale... No matter what geometry we add or how the objects overlap, the result will always be a clean voxel mesh."* That's the developer's superpower, not the player's.

**Commercial:** EA 24 January 2024, $29.99. **1 million players in 4 days** — *not* "1M copies in a week." All-time Steam CCU peak 160,405. 5M players by Jan 2026. **Keen has never published copies sold**; every milestone is "players," which includes Family Sharing and refunds. Treat 5M as an upper bound on units.

**Cost: 75 people averaging 12 years' experience, ~23 programmers including 7 graphics programmers.** ~4.5 years to EA, ~7 to 1.0 → roughly **350–450 person-years on top of a twenty-year-old engine**, funded by Hiro Capital, Tencent and a German government grant. **Not reproducible without a pre-existing engine.** Water alone costs ~2.6 ms/frame on a 4060 Ti at 1440p. Saves are bounded only by design rules: max 10 Flame Altars, base volumes 40³–160³ m, everything outside a base reverts after 30 minutes.

### 1.9 Astroneer and No Man's Sky

**Correction: Astroneer is not literal cubic voxels.** It's a signed density field with marching cubes. Brendan Wilson: *"each voxel stores a density value… Where that crossover happens between positive and negative is where the surface is going to be… We use one called marching cubes."* Cell resolution has never been published. **[unconfirmed]** UE4, stuck on 4.23 until 2025.

**The art direction is the relevant part and it's radical: zero textures.** *"This art style means no textures in the game… no UV unwrapping."* The faceting is flat/low-poly shading over a smooth isosurface, so newly generated triangles never show seams. Third person chosen for information density.

**What deformation cost:** a **4-player cap**, because *"the host has to generate and maintain collision information for every player, while processing all of the terrain deformations."* Wilson shipped a known-broken system knowingly: *"The replication code for the terrain is novel, and will ship with some known issues."* Terrain desync shipped as a bug class. Unbounded save growth forced an in-game **Save File Repair Tool** (June 2024). 3.74M+ units / 8M+ players as of March 2022. Wilson's summary: *"we picked the hard way on everything."*

**No Man's Sky** (Innes McKendrick, GDC 2017): simulate on a sphere, store on a cube; voxel shell ~128 m thick; **nearest-LOD voxel = 1 m³**; regions 32×32×32 m polygonised at 36³; **~6 bytes/voxel held uncompressed in RAM** deliberately *"to let us do really quick terrain edits."* Dual contouring (*"We started out with marching cubes"*). Generation is **stateless per voxel**, forcing a coarse 2D pre-pass. His most useful line: *"physics and nav meshes take up a way more significant chunk of our time than actually generating or polygonizing the terrain."*

**Terrain edits are stored as bounded deltas and are not synced between players.** A save-editor study puts the cap at ~15,000 edits with a 256 buffer, overflow overwriting oldest — *"a limitation built into the game, not a bug."* Hello Games has never stated a number. **[unconfirmed]** Art direction: Chris Foss / Ralph McQuarrie, rule-based complementary-colour palettes, **explicit avoidance of black**.

**The paired lesson:** Astroneer chose full persistence + full replication and got a 4-player cap, save bloat, and years of desync. NMS chose bounded persistence + no replication and got its most-hated behaviour plus a crippled multiplayer feature. **If deformation is your core verb, budget for authoritative replication and unbounded save growth from day one.** You have no deformation verb, which is a gift.

### 1.10 EverQuest Next / Landmark — the post-mortem that matters most to you

This is the one to read carefully, because it is the closest historical analogue to what you're building: **a voxel world whose headline feature was emergent AI NPCs with memory.** It is also the biggest failure in the survey.

**Tech.** Licensed **Voxel Farm**, confirmed by Miguel Cepero the day after the August 2013 reveal: *"EQNext is using the Voxel Farm engine."* SOE forked it heavily and, per EQ2Wire, diverged so far that upstream improvements couldn't be integrated. **[unconfirmed]** Community documentation puts **1 voxel = 9.6 inches ≈ 24.4 cm**. Islands ~4.9×4.9 km. Build volumes 525×525×450 blocks. Design storage capped at 6,000,000 blocks (purchasable to 48,000,000), **server-side only** — *"no local copies exist on the players hard disk."*

**What density bought — genuinely remarkable emergent creativity.** Players discovered and *named* sub-primitives the developers never designed: **micro-voxels** (place one voxel in air, select 3×3×3, Smooth repeatedly — each pass yields a smaller voxel), **anti-voxels** (*"created by compressing air into a regular voxel shape"*), **Zero Data Voxels**, **Zero-Volume Voxels** (true 45° angles, widthless sheets). Players built "voxel reactors" and traded Voxel Boards at community swaps. Cepero, March 2014: *"Probably the biggest surprise was to see all the emergent techniques devised by the players… Players even had to name these things."*

The counter-testimony from an ex-SOE developer is the deflation: *"The majority of the really crazy sh\*t the voxel tools could do was by pure accident with the system trying to comprehend what the 'player' really wanted to do... It wasn't planned in any way, shape, or form."*

**Why it died — five causes, one of which should scare you.**

**(i) Voxels at MMO scale broke pathfinding, not rendering.** This is the strongest, most senior, on-the-record diagnosis. Holly Longdale, EQ franchise producer, [Variety, March 2019](https://variety.com/2019/gaming/features/to-survive-everquest-must-honor-past-embrace-future-1203169740/):

> *"There was a real nugget of an idea there, but a technical hurdle the team just couldn't get over. All the other stuff that EverQuest is kind of got lost because it was focused on voxels and a dynamically-generated changing world. **There was not enough computational power. If people are digging holes, you have to update pathing for the entire world.**"*

Every terrain edit invalidates the nav graph, server-side, authoritatively, continuously, for all players. EQ2Wire claims NPC pathing didn't work until December 2014 and required 6 GB of pathing data per island per world. **[unconfirmed]**

**(ii) Storybricks did not die because the AI failed.** [TechCrunch, "Game Over For Storybricks," March 2015](https://techcrunch.com/2015/03/08/game-over/): chronically underfunded, raised **under $1M total**, *"almost permanently existing with a runway of between 120 and 30 days."* The founders explicitly deny the Columbus Nova link: *"It was our own decision and Sony Online Entertainment bears no fault for it… our exit had no connection with the Columbus Nova acquisition."* Rosini's line is the one to remember: *"We were too much of a tech company for the gaming industry, and too much of a gaming company for the tech industry."* The ten-person startup had even tried, with an investment bank, to *buy SOE*.

And the myth-deflation, from a self-identified ex-Storybricks developer: *"The Storybricks mid-level AI was (and this is a matter of public record) what game AI people call a utility system."* **Not a breakthrough. A well-executed utility-scoring architecture with excellent PR.** The most-hyped emergent-NPC system in game history was a scored action selector.

**(iii) The AI was inseparable from the pathing problem.** Emergent NPCs that relocate, migrate, and react need exactly the navmesh that a destructible world can't maintain. The two headline features killed each other.

**(iv) Landmark cannibalised EQN.** Ex-SOE: *"Landmark began as nothing more than the tools to make EQN. Then [Georgeson] got a wild hair up his ass to make it a game, which ultimately killed EQN... The designers on EQN wrote hundreds and hundreds of design docs, often rewriting them as goals changed because they had no actual tools to make the game yet."* And on the impossible brief: *"I can clearly remember Dave saying things like 'The creation tools will be simple to use and the most powerful ever seen', as if somehow those 2 things can co-exist."*

**(v) Ownership churn.** Columbus Nova acquisition announced 2 February 2015. **Nine days later**, layoffs — California WARN filing: 140 people. Casualties included Dave Georgeson and EQN lead content designer Steve Danuser. Smedley left in August. Thirteen months from ownership change to cancellation, with both vision-owners gone within six. *No source says Columbus Nova ordered the cancellation.* **[causation unconfirmed]**

**The fact that should sit with you longest: EverQuest Next was never playable by anyone outside SOE.** No alpha, no beta, ever. Massively OP, March 2016: *"We cannot wave farewell to EverQuest Next in this column because it's never actually been in testing."* The 2013 SOE Live combat demo was allegedly staged — EQ2Wire: *"entirely smoke and mirrors, with developers back at the home office 'playing' NPCs"*; an ex-dev: *"the NPCs running around in the 1st gameplay reveal? they were controlled by actual people as there was no pathfinding."* **[credible allegation, not established — but it dovetails exactly with Longdale's on-record statement]**

The "Rallying Calls" — months-long server-wide storylines permanently altering the world, pitched as replacing expansions — were **never shown running**. That is almost precisely your spine loop, pitched a decade earlier, by a studio with a hundred people and a Sony balance sheet, and it never ran once in public.

**Landmark's end:** alpha Jan 2014 → released 10 June 2016 → shutdown announced 5 January 2017 → servers off 21 February 2017. **Eight months as a launched product. All player builds lost — no export, no archive, no refunds.**

The ex-dev's summary is the memo I'd hand to any founder: *"Basically all the systems like pathing, AI, voxels should have been prototyped and tested with placeholders during pre-production. Instead... SOE decided it was a good idea to hire designers, writers, an entire floor of artists and announce a game without even knowing if any of these components were going to work together or if it was fun."*

### 1.11 Hytale — it shipped, and the correction matters

**Correction: Hytale was uncancelled and released.** Do not repeat the "Hytale died" line.

| Date | Event |
|---|---|
| Early 2015 | Development begins; trigger was Mojang's 2014 EULA change cutting Hypixel server revenue ~85% |
| Dec 2018 | Announced; Riot leads **~$7M** angel round. Trailer hits 31M views in a month |
| Apr 2020 | **Riot fully acquires Hypixel Studios** |
| Jul 2022 | **Engine reboot** — rewrite client + server in C++ |
| Nov 2023 | Engine work brought in-house; peak headcount *"more than 110 people"* |
| **23 Jun 2025** | **Cancelled by Riot; Hypixel Studios closed** |
| **17 Nov 2025** | **"HYTALE IS SAVED!"** — Simon Collins-Laflamme reacquires the IP, rehires 30 devs, **abandons the C++ engine**, reverts to the four-year-old legacy build |
| **13 Jan 2026** | **Early Access, $19.99, own launcher, not on Steam** |

**Why the rewrite** ([Summer 2022 update](https://hytale.com/news/2022/7/summer-2022-development-update)): *"Our previous engine was built at a time when we had fewer resources and we hadn't yet come to terms with the scope of what we were trying to achieve… we would hit a range of technical challenges in areas like scaling, compatibility, and the speed at which we could deliver patches and updates."*

**What went wrong.** Riot's public reason at cancellation: *"even after a major reboot of the game engine, the team found that Hytale still wasn't as far along as it needed to be... reducing scope, adjusting timelines... would have meant compromising on what made Hytale special."* The internal accounts contradict it. Technical Director Kevin "Slikey" Carstens: *"Hearing 'it wasn't feature creep'… Systems that were already far ahead of Minecraft at the time were completely re-invented to make them 'even better' resulting in fuck all."* Collins-Laflamme, January 2026 ([PC Gamer](https://www.pcgamer.com/games/adventure/its-a-damn-miracle-we-were-able-to-salvage-hytale-original-co-founder-and-new-owner-simon-collins-laflamme-says-after-years-in-development-at-riot-it-was-barely-playable/)):

> *"four years of engineering went into rebuilding the engine rather than gameplay features... that leaves us with a four-year gap and a lot of catching up to do, and that rebuilt engine is never gonna be used."*

On the inherited state: *"it was barely playable... Camera, movement, combat, crafting, building, gameloop, sounds, rendering. Everything, everything was wrong."*

**Two numbers to correct.** The widely-repeated **">$100M spent" has no source** — SEO aggregators and "reportedly," no filing, no named insider. The only hard financial figure in Hytale's history is the ~$7M 2018 round. And **"2.8 million players on launch day" is fabricated** — it originated in an in-game chat message on a 100-player server posted by someone using the username "Simon" during a bug that let anyone join under any username. Outlets ran and retracted it. What *is* verified: most-watched game on Twitch at launch, peak **~420,000 concurrent viewers.** Hypixel Studios has never published CCU, DAU, MAU or copies sold.

**The art-direction correction is the useful one for you: Hytale's character models are not voxel models.** Art director Thomas "Xael" Frick: *"we only use 2 primitives: Cubes (6 sides), Quads (2 sides). No edge loops, no special topology, no triangles, pyramids…"* / *"No spheres allowed!"*

And they use **dual texel density on purpose**: characters and attachments at **64 px per unit**, props and blocks at **32 px per unit**. The stated reasons are directly applicable to your three arguing NPCs:

> *"higher density for characters allows for details on skin, tattoos, makeup, eye and mouth motion… We felt constrained by the lower resolution"*

> *"especially in first person, when fighting… Large pixels in front of the camera tend to distract"*

> *"**Higher density for characters helps them detach from the environment**… avoiding a chaotic perception of space."*

**That last quote is the single most actionable art-direction line in this entire document for your project.** Your set is cardboard and your actors are real — so give the actors more texel density than the set. It's free, it's a deliberate style, and it makes the camera read the characters as the subject.

Renderer note: *"We aren't using the industry standard PBR workflows"*; *"We paint lights and shadows inside textures and use real lights/shadows to bring everything together."* Anti-cubic tricks: transition-texture quads (*"one of the many tricks we use to try to break up the cubic nature of our game"*), RGB tinting, hybrid cube+model blocks, leaves bisected on angled planes randomly rotated per placement.

**Cost:** ~10 years and one cancellation to reach Early Access; **four years poured into an engine that was thrown away.** Team went <40 → 110+ peak → ~70 at closure → 30 rehired → 60+ today. The revival kept cross-platform as a goal and discarded the means; no replacement technical plan has been announced. Collins-Laflamme, July 2026: *"there aren't many reasons to come back and play Hytale right now."*

### 1.12 The Sandbox — relevant to your audience

Covered partly in Part 0. The additional context:

**Corporate reset, August 2025:** Animoca took full control; **~50% of ~250 staff cut**; offices closed in Argentina, Uruguay, South Korea, Thailand, Turkey. Co-founders **Arthur Madrid and Sébastien Borget removed from executive roles** (Madrid to board chairman, Borget to "global ambassador"); **Robby Yung** installed as CEO. Both Borget and Yung are judges on the jam you're entering, so they are ecosystem-facing, not gone.

**"The Sandbox 3.0" strategy** (Yung, [Sept 2025](https://www.sandbox.game/en/blog/An-Update-on-Our-Vision-and-the-Road-Ahead/3499/)): claimed cumulative scale of 400+ brands, 400,000+ creators, 8M+ users, 1.7M unique 3D assets. **AI on two tracks** — internal ops, and *user-facing generative AI*: *"already begun training custom AI models focused on asset generation."* Partnership with Rosebud AI. SANDchain testnet October 2025. Mobile return in internal playtest.

**Health, honestly — and this paragraph is for your planning only. Never repeat the DAU figure on stage; two of your four judges ran this company.** Press reporting around the August 2025 restructuring put daily active users at only a few hundred outside event windows ([CoinDesk](https://www.coindesk.com/business/2025/08/28/the-sandbox-cuts-50-staff-restructures-as-animoca-brands-take-control)). It is a single-source journalistic characterisation, not a disclosed metric, and it sits awkwardly against the official 8M+ cumulative users. **[unconfirmed]** The better picture comes from seasons: 2025 ran two Alpha Seasons with **144,000+ combined players**, 7.9M+ quests. Alpha Season 6 (Sept 2025, Cirque du Soleil): 30 Experiences, 100,000+ hours played, avg ~97 min/session. Do not quote a SAND price — live sources returned contradictory figures on 17–18 August 2026 and I could not resolve them. **[unconfirmed]**

**Voxel pipeline:** **1 metre = 32×32×32 voxels** — voxel size fixed at 1/32 m. Recommended cap 512 voxels per axis. Standard building max 8×8 blocks (256×256 voxels), floors 4 blocks high. **A human NPC/avatar is 2 metres = ~64 voxels tall.** VoxEdit (model → rig → animate) → export as asset → Game Maker → LAND → publish.

**Note the density comparison:** The Sandbox's 1/32 m voxel is roughly 3 cm — *finer* than Teardown's decimetre. And The Sandbox does not look better than Teardown. That's the clearest illustration available that density isn't what makes voxel scenes look good — though it isn't a controlled comparison, since The Sandbox targets a browser and low-end runtime with no ray tracing at all.

### 1.13 What's new in 2025–26

**Releases.** Hytale EA (Jan 2026). Teardown multiplayer (Mar 2026). **Lay of the Land** — solo dev, Steam release 8 April 2026, voxel visuals + procedural terrain + a world-simulation system feeding exploration and combat. **Voxile** — voxel destruction RPG/FPS, EA March 2025. Enshrouded 1.0 scheduled 15 October 2026.

**Rendering research.** The standout is **Aokana: A GPU-Driven Voxel Rendering Framework for Open World Games** (arXiv [2505.02017](https://arxiv.org/abs/2505.02017), I3D 2025) — SVDAG-based with LOD and streaming, real-time rendering of scenes with **tens of billions of voxels**, claiming up to 9× memory reduction and 4.8× faster rendering than prior state of the art, explicitly designed to drop into existing engines alongside mesh rendering. Also: *Encoding Occupancy in Memory Location* (CGF, Nov 2025), *NAADF: Globally Illuminated Voxel Worlds Accelerated with Nested Axis-Aligned Distance Fields* (CGF, May 2026), *SCom DAG* (ACM TOG, July 2026). **[DOIs unverified for the latter three]** In practice, sparse **64-trees** (branch factor 64 rather than 8) are displacing classic SVOs among practitioners.

**Gaussian splatting is not a competitor and it's worth knowing why.** 3DGS is a *capture and reconstruction* representation, not an authoring or simulation representation. It does not give you editable, destructible or gameplay-queryable geometry. If someone at the jam asks why you didn't use splats, that's the answer.

**Engine tooling.** **Voxel Plugin 2** (Unreal, UE 5.6/5.7 only) — volumetric destructible infinite worlds, tessellation via Nanite, deep PCG integration. **Zylann/godot_voxel** — Godot 4 C++ module (GDExtension still on the roadmap), blocky + Transvoxel smooth LOD terrain, infinite chunk paging, in-game editing. Unity has no dominant single solution; the ecosystem is fragmented Asset Store packages.

**Voxel-adjacent AI.** **TRELLIS.2** (Dec 2025, MIT licence, 4B params, image-to-3D on an O-Voxel sparse representation) is open state of the art. Text-to-3D still trails image-to-3D materially. And relevant to you: **LLM-driven NPCs in voxel sandboxes are now a real, shipping mod category** — [PlayerEngine](https://www.curseforge.com/minecraft/mc-mods/playerengine) (*"your LLM decides what to do, PlayerEngine gives your NPC the body to do it"*), [Steve AI](https://modrinth.com/mod/steve-ai), [CraftAgent](https://modrinth.com/mod/craftagent), plus academic work like MineNPC-Task. **You are not the first person to put an LLM in a voxel world.** Your differentiation is not the bridge; it's the persistence, the canon, and the memory of the visitor. Say that plainly rather than letting a judge discover it.

---

## Part 2 — Synthesis: what makes a voxel world feel *alive* rather than merely *detailed*

### 2.1 The two modes

**Voxel density as spectacle** buys you a screenshot, a trailer, and a technology press cycle. It is measured in voxels per metre. Its natural failure mode is a demo that impresses and then goes quiet, because the density serves the renderer and the renderer serves nothing.

**Voxel density as mechanic** buys you a *verb* the player could not otherwise perform. It is measured in *what the player can do that they couldn't at half the density.* Its natural failure mode is scope collapse, because a real verb propagates into pathfinding, networking, persistence, and level design simultaneously.

The test is one question: **if you doubled the voxel size, which mechanic would break?** If the answer is "none, it would just look chunkier," you have spectacle.

### 2.2 The scoreboard

| Game | Density | Mode | Earned it? |
|---|---|---|---|
| **Ace of Spades 0.75** | ~1 m | **Mechanic** | **Yes.** At 2 m a player-sized tunnel is no longer expressible and the 64-voxel vertical budget halves to 32. The coarseness is tuned, not incidental — 1 m is the largest voxel that still permits the shovel verb. |
| **Vintage Story** | 1 m terrain, 16³ sub-block, opt-in | **Mechanic** | **Yes, and most efficiently of anyone.** Three crafting verbs off one grid, no engine rewrite, gated behind a config flag because they knew it wasn't free. |
| **Teardown** | ~10 cm | **Mechanic** | **Yes.** Double it and you can't shave a doorway — you can only demolish. The precision is the heist. |
| **Enshrouded** | 50 cm | **Mechanic** | **Yes**, though the strongest verb (the arbitrary-mesh brush) was kept for developers. |
| **Astroneer** | density field | **Mechanic** | **Yes** — and it cost them a 4-player cap and years of desync. Honest trade. |
| **No Man's Sky** | 1 m³ | **Hybrid** | **Partly.** Deformation is real but capped at ~15k edits and not synced. Spectacle wearing a mechanic's coat. |
| **Veloren** | 11³ per block | **Spectacle** (deliberately) | **N/A** — density serves *authoring throughput* for 45 volunteers, not player verbs. A legitimate third use. |
| **The Sandbox** | ~3 cm | **Spectacle** | **No.** Finest density in this table; nothing in the player's hands requires it. |
| **Atomontage** | sub-mm | **Spectacle** | **No.** ~20 years, ~15 people, zero shipped games. |
| **John Lin** | micro | **Spectacle** | **No** — and he wrote the essay explaining why, then stopped posting. |
| **Voxel Quest** | fine | **Spectacle** | **No.** *"there doesn't seem to be [a game]."* |
| **EverQuest Next** | 24 cm | **Mechanic on paper** | **Never shipped.** The verb (dig anywhere) killed the other headline feature (emergent NPCs) via pathfinding. |

### 2.3 What actually makes a world feel alive

Strip the rendering out and the games that feel alive share four properties, none of which is density.

**1. State that persists and accumulates visibly.** Atomontage's craters and footprints. Ace of Spades' lunar late-round maps. This is the thing that turns *a place* into *a place where something happened*. **This is your whole thesis and it has nothing to do with voxels.**

**2. Consequence — a change the player can point at and attribute.** Landmark's Player Studio did per-block ownership attribution with automatic royalty splitting. Ace of Spades' tunnels are readable at a glance. Attribution is what converts change into meaning.

**3. Legibility over fidelity.** Ace of Spades' 1 m voxels beat Atomontage's sub-millimetre ones for aliveness, because you can *read* a 1 m edit from across the map. Hytale's dual texel density says the same thing from the art side: *"Higher density for characters helps them detach from the environment."*

**4. Agency that survives contact with the systems.** EQN's emergent NPCs were technically real (a utility system, competently built) and died anyway, because the world they were supposed to move through couldn't maintain a navmesh. **A feature that works in isolation and breaks against another feature is not a feature.**

### 2.4 The three cautionary patterns

**The engine-without-a-game.** Voxel Quest, Atomontage, John Lin, arguably Dwyer. Woolery's self-diagnosis: *"I can't build a business off an engine alone."* The renderer is the fun part and the game is the hard part, and building the fun part first is a trap that has eaten decades of talent.

**The rewrite that eats the runway.** Hytale burned four years on an engine it threw away. Dwyer's 0.5.0 *"Removed all voxel-related code from the engine"* cost him transparency, procedural terrain, and networking, none of which have returned. The format that renders fastest is hostile to collision, GI, pathfinding, serialisation, and per-voxel attributes, so *every* voxel project eventually faces a rewrite, and the rewrite always costs more than the estimate.

**The two features that kill each other.** EQN is the canonical case: destructible world + emergent AI NPCs, where the first makes the second computationally impossible. When you have two headline features, spend an hour asking whether they're actually orthogonal, before you spend a year finding out.

---

## Part 3 — Design memo

I've read your original spec and your v0.1 technical brief. The brief materially changes my answer, and mostly in your favour. What follows is my honest read, including the parts where I think you're wrong.

### 3.0 What your brief got right

Stating this first because the rest is critical and I don't want the balance to mislead.

**Server-side projection is the correct architecture.** Judgment in one hosted Host Mind, canon in your DB as source of truth, stateless character-runtime workers rendering directives into dialogue, engine as a display surface behind an adapter. That is the right shape, and it is the shape that survives contact with the EQN post-mortem: SOE's fatal coupling was that the *world simulation* and the *NPC intelligence* shared a substrate (the navmesh) that neither could maintain. You have deliberately decoupled them. The world can't break your NPCs because the NPCs don't live there.

**"Cognition scales with narrative decisions, never with cast size or traffic"** is the best line in your brief. It is a unit-economics statement disguised as a design rule, and it is the thing an investment committee actually wants to hear. Put it on a slide, verbatim.

**The degradation mode is right.** Host timeout → tick skipped → world runs on last directives → degrades to static rather than crashing. That is a system designed by someone who has watched a demo fail live. Keep it, and *say it on camera* — "if the Host is down, the world goes quiet, it doesn't fall over" is a 5-second line that reads as engineering maturity.

Now the criticism.

### 3.1 High-density voxel: the recommendation

**Not in the build. Not on the roadmap slide. Nowhere.**

Your v0.1 brief makes this sharper than it would otherwise have been, and here's the argument in one move:

**You have declared the engine a disposable display surface with a one-file swap cost. High-density voxel rendering is an investment in exactly the layer you have declared disposable.** Those two positions cannot both be held. If the engine is a display surface, then engine-layer technology investment is by definition off-thesis. If you're willing to invest engineering into high-density voxel, then the engine isn't a display surface and your adapter story is a fiction. Pick one. I strongly recommend the first, because it's the one that's true and it's the one that's differentiated.

The supporting arguments, in descending order of force:

**1. Nothing in your design has a spatial verb.** Run the Part 2 test on your own project: *if you halved the voxel resolution, what would break?* Nothing. Not one mechanic. Your NPCs confront each other, post notices, move goods, and snub people. None of those is a spatial operation on a voxel field. You have zero destruction, zero sculpting, zero terrain deformation, zero mining. **You would be paying the highest price in this survey for the only category of benefit you have explicitly designed away.**

**2. The one project that tried your exact combination died of it.** EverQuest Next paired a high-resolution destructible voxel world with emergent AI NPCs that had memory and would relocate in response to events. It never ran in public, not once, because the destructible voxel field made the navmesh unmaintainable and the NPCs needed the navmesh. Two headline features, mutually lethal. Holly Longdale on the record: *"There was not enough computational power. If people are digging holes, you have to update pathing for the entire world."* Your architecture has already dodged this. Do not walk back into it.

**3. The roadmap slide is worse than the build.** In the build, voxel density costs you days. On a roadmap slide, it costs you *the judges' attention*, which is scarcer. A roadmap line reading "high-density voxel rendering" invites Yat Siu or Mohamed Ezeldin to ask a rendering-pipeline question you have no plan for, in a room where your differentiation is persistent agentic memory. **Every question a judge asks about your renderer is a question they didn't ask about your canon store.** The jam theme is "Build What Creators Need Next" and the criteria are creativity, technical execution, UX, and innovative use of agentic AI. Rendering technology scores on none of them.

**4. Your target platform contradicts it anyway.** The Sandbox's voxel is ~3 cm — already finer than Teardown's. If "Sandbox next" is your roadmap line, then the fidelity ceiling of your eventual platform is *already set by the platform*, and it isn't yours to raise. The roadmap line that earns credit is "the cast ships into whatever the creator's world already looks like" — which is an *adapter* claim, not a rendering claim, and it's the one you can actually keep.

**What I am *not* saying.** I am not saying skip visual quality. Voxel *art direction* — palette, soft shadows, low sun, AO, silhouette, bloom — belongs squarely in the 10-day build, costs roughly two days, and materially improves the one deliverable that matters (a one-minute video). See 3.2. The distinction is:

> **Voxel density is engineering. Voxel look is art direction. You want the second and you can buy it for two days and zero dollars.**

If someone at the jam asks about voxel density, the winning answer is a single sentence: *"Density buys destruction and sculpting; we have neither, so we spent that budget on memory instead."* That's a confident answer that makes the questioner's premise look naive. That's worth more than any roadmap line.

### 3.2 The cheapest Teardown-ish look, ranked

You need a plaza and three buildings and three humanoids that photograph well for sixty seconds. You do not need a voxel engine.

**Step zero, and it dominates everything: do not model anything.**

**[Mini Mike's Metro Minis](https://github.com/mikelovesrobots/mmmm)** — 400+ city-themed voxel models: **~100 humanoid characters**, buildings, storefronts, sidewalks, fences, trash cans, fountains, bus stops, trees. Available in `.vox`, `.fbx`, `.collada`, and Unity prefab. **CC BY 4.0** (credit "Additional Artwork by Mike Judge"). 835★. **Your entire brief — plaza, three buildings, three humanoids — already exists in that repository.**

Its README also tells you the animation plan, verbatim: *"Are these characters rigged? Nope… I recommend making them waddle or sticking a popsicle stick up their butt and dragging them around."*

**One warning that catches everyone: Kenney's voxel-tagged packs appear to be pre-rendered 2D sprites (128×128 tiles), not `.vox` models.** **[unconfirmed]** — worth thirty seconds to check yourself at [kenney.nl/assets/tag:voxel](https://kenney.nl/assets/tag:voxel) before you either budget on them or discard them.

#### The ranking

**Ranked purely on visual quality per day. This is *not* the deciding criterion for you — see the section immediately below.**

| # | Option | Days to a *good* still | Days to 60s of video | Verdict |
|---|---|---|---|---|
| **1** | **MagicaVoxel's built-in path tracer** | **2–6 hours** | — (stills and turntables only) | **Best ratio in existence.** No camera fly-through, no gameplay. |
| **2** | **MagicaVoxel → Godot 4 Forward+** | **1.5–2.5 days** | 3–5 days | Best-looking playable result. |
| **3** | **Blender (Cycles) for beauty inserts** | 1–2 days if fluent, 4+ if not | Cutaways only | Legitimate cheat, see below |
| **4** | **Luanti + tuned lighting/texture pack** | ~half a day acceptable, 2–3 days good | 3–4 days | Hard visual ceiling — but see below, it wins on a different axis |
| **5** | **Unity 6 URP** | 2–3 days | 4–6 days | ~1 day slower than Godot |
| **6** | **Three.js / web** | 2–4 days if fluent JS | 4–7 days | Only if it must run in a browser |
| **7** | **AI voxel asset generation** | Net time **sink** | — | One 2-hour lottery ticket, max |
| **—** | **Zylann/godot_voxel** | **Do not use** | — | Requires a custom Godot build. For a static plaza it contributes nothing. |

#### The one that matters most for *you*, and the trade you're making

Every engine on that list gives you a walkable world. What Luanti gives you that the others don't is **a server that can be running, with an avatar and a chat channel, by the end of Day 2** — with zero engine work between now and then. That's the axis that matters, because the demo's content is elapsed time.

**But I want to name the cost honestly, because it cuts against my own Part 1 finding.** I told you soft shadows plus ambient occlusion is the two-ingredient recipe. **Luanti has no SSAO.** You would be buying a running clock by giving up half the recipe. That's a real trade and you should make it deliberately.

**And to resolve an apparent contradiction with §3.1:** I argued there that your engine is a disposable display surface, which sounds like it should make switching to Godot free. It doesn't, and here's the distinction. The *adapter* is one file. The *running server instance holding N days of accumulated wall-state* is not. Switching engines on Day 5 doesn't cost you a rewrite — it costs you the clock, and the clock is the deliverable. **The engine is disposable; the elapsed time is not.** That's the honest version of the argument, and it's the version that survives.

**Decision gate — answer this before Day 1:**

- **If your capture machine is an Apple laptop:** the Luanti look pass is probably not viable. Volumetric lighting benchmarks at **83–98 ms/frame (~10–12 FPS) on an M1 MacBook Air at 880×510**, and you cannot capture clean 1080p from that. Either capture on a Windows/Linux box with a discrete GPU, or switch to **Godot + a staged return visit** (where "staged" means the canon and memory are genuinely six days old, but the walk-in shot is composed rather than live — still honest, still verifiable via on-screen event IDs).
- **If you have a Windows/Linux capture machine:** go hybrid, below.

**The hybrid recommendation:**

- **Luanti** as the live world (the honest gameplay capture — this is where the return visit happens).
- **Two days of look tuning** on Luanti: `enable_dynamic_shadows`, `enable_bloom`, `tone_mapping` (Hable filmic), `debanding`, `antialiasing`, low sun angle, a 32px stylised texture pack, a tight 12–16 colour environment palette.
- **MagicaVoxel's path tracer on day 2** for three to five hero stills of the plaza and the cast. Renders in hours, looks fantastic, and is your **insurance policy** — you have good-looking images no matter what happens to the build.
- **Intercut them.** Beauty inserts over gameplay is standard practice. Nobody holds it against you as long as the gameplay footage is honestly labelled.

**Luanti's honest ceiling, so you're not surprised.** Post-processing exists but is all default-off: `enable_dynamic_shadows`, `enable_bloom`, `tone_mapping`, `enable_auto_exposure`, `enable_volumetric_lighting`, `debanding`, `antialiasing`, `fxaa`. **Absent: no SSAO, no depth of field, no normal/roughness maps, no SSR, no shadow-casting point lights.** In a game made entirely of cubes, **missing crevice AO is the most visible gap** — and it's precisely the thing that makes Teardown's voxels read as solid. There is no OptiFine/Iris equivalent and no mod-facing shader API. The last release with genuinely new visual features was **5.10.0, November 2024**. Ceiling: well-art-directed 2013-era Minecraft-with-shaders. An outdoor daylit plaza is close to the worst case for that feature set — **so shoot at low sun angle, golden hour, with long raking shadows, and consider a partly enclosed plaza with overhangs so bloom and shadow have something to do.**

Two hard warnings.

- **Target Luanti 5.16.1** (10 May 2026). **5.16.0 is reported as broken** — *"please don't use it."* 5.17.0-rc1 landed 13 August, too fresh for a deadline build. **[unconfirmed]** — I could not re-verify the release table at the end of this research; check [github.com/luanti-org/luanti/releases](https://github.com/luanti-org/luanti/releases) yourself before installing, since getting this wrong costs you a rebuild on Day 1.
- **Mac users: volumetric lighting benchmarks at 83–98 ms/frame (~10–12 FPS) on an M1 MacBook Air at 880×510.** See the decision gate above.

**If you already know you want a bespoke plaza and the return visit can be staged another way,** Godot 4 Forward+ is the better engine and the settings that matter are: DirectionalLight3D at −8° to −15° X-rotation with **`Angular Distance` 0.5–2.0** (this is the single highest-value dial — soft contact-hardening shadows are literally Gustafsson's trick), Shadow Filter = Soft Ultra, SSAO on with `Light Affect` pushed to 0.2–0.4 (not physically correct; looks right), SDFGI on, **AgX tonemapping** (not ACES — ACES desaturates bright values and will wash out a saturated voxel palette), Glow with Blend Mode = Screen and radius controlled via `Levels` 3+4+5, both depth fog and volumetric fog, and DOF via **CameraAttributesPractical on the Camera3D** (it moved out of Environment in Godot 4). Auto-exposure **off** for video consistency.

#### Three characters, distinct and expressive, with no animation budget

Ranked by value per hour:

| Trick | Cost | Reads? |
|---|---|---|
| **Camera cuts instead of animation.** 60s = 12–20 shots at 3–5s each. | ~0 | **Enormous. #1 item.** A pose that looks dead for 15s looks intentional for 3. |
| **Distinct height + silhouette + reserved hue.** Scale one to 0.85×, one to 1.15×. Hat, prop, different body width. **One saturated accent hue each, used nowhere in the environment.** | 1–2 h each | **This is what makes three characters into three characters.** Height reads at any distance; hue alone does not. |
| **Speech bubbles / nameplates** (Godot `Label3D` billboarded, or Luanti `hud_add` / `set_nametag_attributes`) | 1–2 h | **Cheapest substitute for a face by an order of magnitude.** A bubble with "!" beats four hours of head animation on a 3-voxel face. |
| **Idle bob:** `y = base + sin(t*2 + phase)*0.03`, different phase per character | 0.5 h total | Yes. Vertical motion alone reads as alive. |
| **Turn-to-face:** lerped yaw, 0.2s ease | 0.5 h | Yes — reads as *intent*, which the brain scores as expressive. |
| **Hop + squash/stretch:** tween Y over 0.35s, scale Y −12% / XZ +12% on takeoff and landing | 1 h | Cheapest "cartoon alive" primitive there is. |

**And the strategic call: do not auto-rig your own voxel characters on a ten-day clock.** MMMM characters are not rigged. The only pre-rigged Mixamo-compatible voxel humanoids I found are in [monogon/Max Parata's](https://maxparata.itch.io/) paid packs under **CC BY-ND** — NoDerivatives makes recolouring legally murky, though his animation pack is CC0. Mixamo's current documented constraints are **[unconfirmed]** — Adobe appears to have removed Mixamo from the Creative Cloud help guide entirely. A walk cycle is 3–6 hours the first time. **Take the walk from Luanti's built-in `character.b3d` and spend the time on camera cuts instead.**

**Steal Hytale's dual texel density.** Characters at 2× the texel density of the environment, deliberately. It is free, it is a defensible style, and per Hytale's own art director it exists specifically to *"detach [characters] from the environment."* Your entire thesis is "the set is cardboard, the actors are real" — dual density makes that thesis *visible in a single frame*.

**And steal Atomontage's persistence-as-visual-language.** If NPC A confronted NPC B in the plaza on Day 4, leave something behind: a posted notice on a wall, a scorch mark, a moved crate, a shuttered stall. Cost: a handful of node swaps in a Luanti mod. Value: when the camera returns, the plaza *visibly remembers*, and you get to point at it. **This is the cheapest, highest-leverage art idea in this entire document for your specific project.** Your claim is "verifiable accumulated history." Right now that history lives in a database. Make it live on a wall.

**Ship these hooks on Day 2, not Day 6.** They accumulate — that's the entire point — so they have the same lead-time property as the tick loop. Building them late means the camera returns to a plaza that remembers one day.

### 3.3 Scope: what to cut, bluntly

Your original spec was tight. Your v0.1 brief has grown a brand/creator onboarding pipeline, a continuous social ingestion pipeline, and a Host Mind architecture — while the timeline stayed at ten calendar days, which is **six build days plus two production days** (Part 0).

**The organising principle: some deliverables are time-locked and the rest are not.**

Two things require elapsed wall-clock time and therefore cannot be built late:

1. **The tick loop** (the drama has to have actually happened).
2. **Persistence-as-visual-language** — notices on walls, moved crates, shuttered stalls. If you ship these on Day 6, the Day 7 capture shows *one day* of accumulated wall-state instead of five. **This has exactly the same lead-time property as the clock, and it's easy to miss.**

Everything else — onboarding, minting, ingestion, the look pass, the UI, the video — can be built at any point. **So the schedule is not a priority ordering; it's a dependency ordering.** The two time-locked items are the critical path and everything else is slack.

**Cut list, in order of confidence:**

**1. Continuous social ingestion — cut entirely. Highest confidence.**
It is an unbounded external dependency (rate limits, auth, API changes, platform policy) on a system whose value proposition is *reliability of memory*. It cannot be verified in a sixty-second video — a viewer cannot tell an ingested post from a hardcoded one. And it is a live demo hazard: you're piping a brand's real, unvetted feed into an LLM that improvises in-world dialogue, on camera, in front of the brand's potential partners. **One canned example plus a roadmap line gets you 100% of the credit at 0% of the risk.**

**2. "Mint NPC #4 on camera" as a *separate* beat — fold it into onboarding.**
It's the same demonstration twice. The onboarding pipeline already produces a cast from a text input; minting a fourth character is that pipeline with n=1. Show it once, as the tail of the onboarding sequence: the new character walks into the plaza and reacts to canon it wasn't present for. **One beat, not two.**

**3. The hidden fourth showrunner Mind — already dead, and that's good news.**
Your one-Mind constraint has quietly solved your "known weak plank." With a single Host Mind holding judgment, **the showrunner is not a bolted-on mitigation, it is the architecture.** Coherence review isn't a fourth agent vetoing three others; it's the same mind that authored the tick, checking its own arc. That is strictly better and it costs nothing. **Say this on stage** — "our incoherence mitigation isn't a component, it's a consequence of the architecture" is a strong line.

**4. Reduce the onboarding pipeline to its narrowest verifiable form.**
Keep: paste a character sheet / IP doc → Host extracts character, voice, themes → draft IP bible → creator approval gate → spawns into world. Cut: multi-platform social handle scraping, automatic voice inference from feeds, anything requiring a third-party auth flow. **The approval gate is the part to keep and emphasise, because it's the part that says "we understand IP holders."** In a room containing Sébastien Borget and 400+ brand partnerships, the approval gate is worth more than the extraction.

#### The single strongest on-camera moment

**The return visit. Not close.**

The onboarding moment is impressive but it is *a category everyone at this jam will demo*. "Paste text, get an agent" is what an agentic-AI hackathon looks like from the outside. It's table stakes in that room, and it is fully reproducible by a competitor in an afternoon.

The return visit is the only thing you have that **cannot be built quickly**, because its raw material is elapsed time. When NPC A greets you as an ally and complains, accurately and with a citation, about what B did on Day 4 — that is a claim about *persistence*, which is precisely and exactly what Minds is differentiated on. Read Animoca's own framing: *"Minds are persistent agents that remember your context; this knowledge compounds across every session"* and *"always-on AI entities that function as persistent networked services rather than simple chat sessions."*

**Your return visit is the most literal possible demonstration of the sponsor's core thesis.** Nobody else's demo will show a world that ran for days while nobody was watching. Lead with it.

**One caution, so you don't oversell it.** A viewer *cannot* distinguish five days of real ticks from a seeded database with backdated timestamps — the same objection I used to cut social ingestion applies here. So don't claim "this can't be faked." **Make the receipt visible instead:** put the event ID, timestamp, and source event on screen next to the dialogue. The drama is the hook; the receipt is the proof. What you actually have is something that's *hard to build and easy to verify*, which is a better claim than *unfakeable* and happens to be true.

#### Revised schedule

**Day 1 = Tue 18 Aug. Day 8 = Tue 25 Aug. 26–28 Aug is submission buffer.**

- **Day 1:** Engine + adapter + Host Mind bridge. Get one NPC to say one thing driven by one Host directive. **Plus: stand up the Telegram surface as a second adapter target** (see §3.5 — it's your kill condition *and* your engine-agnostic proof, and Minds is natively Telegram-addressable, so it's nearly free). Nothing else.
- **Day 2 — hard gate:** Canon store + tick scheduler + event logger. **Plus the world-state hooks** (node swaps for posted notices, moved crates, shuttered stalls) — these are time-locked, they must ship today, and by your own costing they're a handful of lines in a Luanti mod. **Import canon. Start the clock before you sleep.** If the clock is not running at the end of Day 2, invoke the kill condition — move to the Telegram world and start the clock *there*. **The clock is non-negotiable; the 3D client is not.**
- **Day 3:** Visitor memory + the opinion-taking interaction + **the citation check** (§3.5 — resolve every referenced event ID against the canon store before rendering the line; a few hours, protects your most important five seconds). Then *visit the world yourself and record it.* That's your "day 2" footage.
- **Day 4:** Look pass. Palette lock, low sun, bloom/tonemap/shadows, MMMM assets placed, three characters differentiated by height/hue/prop. Render MagicaVoxel hero stills as insurance.
- **Day 5:** Onboarding pipeline, narrowest form, with the approval gate.
- **Day 6:** Slack day. Shot list and shot budget written (see below). Fix whatever broke. **Do not start anything new.**
- **Day 7:** Capture. The clock has been running since end of Day 2 and visitor identity since Day 3, so **the return visit is genuinely four days old.** Use that number — it's the one your schedule actually produces. Shoot the split-screen Telegram beat here too.
- **Day 8:** Cut, grade, submit. **Submit on Day 8, not on the 28th.**

#### Shot budget — because the list of "must include" beats exceeds 60 seconds

If you're held to sixty seconds, you cannot fit everything I've recommended. Allocate explicitly:

| Beat | Seconds |
|---|---|
| Cold open: the plaza, three characters, one line of conflict | 8 |
| Onboarding: handles/sheet in → cast out → approval gate | 12 |
| The tick loop running, with a visible world-state change | 8 |
| **The return visit + on-screen citation receipt** | **18** |
| Split-screen: same event, plaza and Telegram | 8 |
| Architecture card: one Mind, showrunner, "cognition scales with narrative decisions" | 6 |
| **Total** | **60** |

Note what that leaves out: the degradation-mode line, the density one-liner, and the mint-#4 beat as a separate moment. **Those belong in the written submission or in Q&A, not the video.** And note the return visit gets 30% of the runtime — that's deliberate. If you find yourself trimming it, you're optimising the wrong thing.

**If the jam permits three minutes** — which I could not confirm — this table relaxes considerably. Check first.

### 3.4 The one-Mind constraint: name it on stage

**Name it — once, briefly, as a design choice rather than a confession.** Hiding it is the only way it becomes a weakness.

**The strong argument, which should lead:**

**Unit economics.** *"Cognition scales with narrative decisions, never with cast size or traffic"* is only true because of the single-Mind design. A naive three-Mind cast pays for every pairwise exchange; a showrunner pays once per beat and then renders the beat into three voices with stateless workers. **That's the difference between a demo and a business,** and every operator in that room will recognise it instantly. Multi-agent is currently the default, and the default has poor unit economics at scale. You have the version that doesn't. That's not a concession — it's the pitch.

*(Being precise about the claim, since it's the one load-bearing argument: narrative beats are not literally independent of cast size, and I don't want to hand you notation that will fall over under a follow-up question. The defensible version is that **your cost is driven by how much story happens, not by how many characters are on stage or how many visitors are watching** — which is exactly the property that makes it scale to a cast of twenty or a thousand concurrent visitors.)*

**Three supporting arguments:**

- **It matches how fiction is actually made.** One writers' room, many characters. Nobody accuses a novelist of cheating because all the characters came out of one head. Use the phrase **"showrunner architecture"** — established creative-industry concept, honest, and it frames the constraint as craft.
- **It's your coherence mitigation, for free.** Your known weak plank was *"tick-driven drama could produce incoherent history."* A single authoring Mind that knows the arc is the structural answer to that. Whether three independent LLM agents would produce coherent drama is genuinely untested — I'm not going to claim the survey settles it, because it doesn't; Storybricks was a hand-authored utility scorer in 2013, not an LLM. But *your* design doesn't have to find out.
- **It's honest, and the alternative is checkable.** If you imply three autonomous negotiating agents, someone can ask about your Minds tier. Overselling in front of an investment committee costs more than being modest in front of one.

**The counter-argument you must have an answer ready for.** Animoca's own framing is explicitly multi-agent: *"the primary actors are artificial intelligences with persistent memory and the capacity to negotiate, collaborate, and transact independently"* and *"A single Mind can be shared across teams, collaborate with other Minds."* Yat Siu will be in the room and that is his thesis.

**The answer:** you are demonstrating the *persistence* half of the thesis — the half Minds actually differentiates on, the half nobody else will show, and the half that requires elapsed time to prove — and you are architecturally ready for the *collaboration* half. Phrase it as **"we built for the capability we could verify today, and designed for the one that's coming."**

⚠️ **Hard prerequisite before you say anything about Circles on stage.** I could not find a public Minds Builder API specification at all, and Animoca's marketing explicitly describes Minds collaborating with other Minds. **Telling Yat Siu that a capability his own marketing describes doesn't exist is the highest-blast-radius sentence in this memo.** Do not say "when Circles land in the Builder API" unless you have personally confirmed the current endpoint list *on the day of the pitch*. Safer phrasing that survives either outcome: *"today the cast is projected from one showrunning Mind; as mind-to-mind collaboration becomes available to builders, characters can hold their own Minds and the showrunner becomes a director rather than an author."*

**Delivery: one sentence in the video, one slide with the diagram, and stop.** Per the shot budget above, this beat gets six seconds. If you spend thirty seconds of a sixty-second video justifying your Mind count, you've made it the story.

### 3.5 Where I think you're wrong

**"The set is cardboard, the actors are real."** Great line, and it's doing something dishonest. It reads as *"we chose not to invest in the set."* But a viewer doesn't perceive "deliberately minimal"; they perceive "unfinished," and they transfer that judgment to the actors, because that's how visual credibility works. Minimal and ugly are different things, and the difference costs about two days. **Rewrite the line as a commitment rather than an excuse: "one plaza, three buildings, lit like a film set."** Then actually light it like a film set.

**"Any engine drops to a roadmap line."** This is the claim I'd most like you to reconsider, because you have a nearly free way to *prove* it instead. Your brief says the swap cost is one file. Your kill condition is already a Telegram group world. **Minds agents are natively addressable by Telegram and email** — that's in Animoca's own announcement. So the second surface costs you almost nothing.

**Show the same cast, at the same moment, in two surfaces at once.** Split screen: NPC A confronts B in the plaza on the left, the same event narrated in a Telegram group on the right. That is a ten-second shot that converts your weakest claim ("engine-agnostic, trust us") into your most credible one ("here it is, twice, live"). It de-risks the demo — if the 3D client breaks on day 7, you have already shot the other half. And it proves the display-surface architecture that the entire rest of your pitch rests on. **I think this is the highest-value idea in this memo after the return visit itself.**

**"Three, not six: triangular drama, half the cognition burn."** Right call, wrong reason. The cognition argument is now moot — your one-Mind design means cost scales with narrative decisions, not cast size, as you yourself wrote. The real reason three is right is *staging*: a two-person argument with a third party who must choose is the oldest legible conflict shape there is, and it gives the visitor a role. **Three is right because the visitor is the fourth corner.** Say that instead; it's a stronger line and it explains why the return visit works.

**The kill condition is written as a failure state.** *"If by D4 the bridge can't sustain a tick loop, drop the 3D client."* Given the split-screen idea above, Telegram isn't a fallback — it's a surface you're shipping anyway. **Rewrite it as a load-bearing feature and the kill condition becomes free.** A kill condition you'd be happy to trigger isn't a risk, it's an option.

**"Deliberately modest terrain; build budget goes to inhabitants, not architecture."** Agreed on the principle and wrong on the accounting. Free CC BY assets mean the architecture budget is *already close to zero* — MMMM has your plaza and three buildings sitting in a repo right now. The choice isn't "architecture or inhabitants"; it's "two days of lighting, or not." **Take the two days.** Your inhabitants are talking heads in a wide shot; the lighting is most of what the viewer will judge them by.

**The thing that worries me most, which isn't in your brief.** Your demo's central claim is that A complains *accurately* about what B did on day 4, citing the event. **The failure mode isn't a crash — it's a subtle one.** If A cites the event slightly wrong, gets the day wrong, or confabulates a detail, an attentive judge catches it and your entire thesis inverts in one second: you become "another LLM demo that hallucinates," which is the exact objection you exist to refute. Nothing in the brief describes a verification step between the canon store and the rendered dialogue.

**Build a citation check.** When a character references a past event, the runtime should resolve the event ID against the canon store and either (a) inject the verified fact verbatim rather than letting the model recall it, or (b) reject and regenerate the line. This is a few hours of work and it protects the single most important five seconds of your video. **It's also the demo:** show the event ID on screen next to the line. "Verifiable history" should be visibly verifiable, not asserted. **It's scheduled on Day 3** in the revised plan above.

Given a choice between two days of voxel work and four hours of citation verification, take the four hours ten times out of ten.

---

## Appendix A — What I could not confirm

Do not assert these on stage without checking:

**Affecting your build decisions — check these yourself:**

- **A public Minds developer API / REST specification or SDK reference.** The DoraHacks detail page returned empty to fetchers. Your own verification supersedes mine, but confirm every endpoint you depend on has been called by you personally. This one gates §3.4's stage guidance.
- **The jam's submission format and closing hour.** No published spec found. The 60-second assumption throughout Part 3 is *yours*, not the jam's.
- **Luanti 5.16.1 as current stable / 5.16.0 as broken.** Reported but not re-verified at the end of research. Getting this wrong costs a Day 1 rebuild.
- **Kenney's voxel packs containing no `.vox` models.** Thirty seconds to check; a false negative discards a free asset library.
- **Mixamo's current documented constraints** — Adobe appears to have removed Mixamo from the Creative Cloud help guide entirely.

**Affecting what you can safely assert:**

- **Teardown's 10 cm voxel figure** is community-documented, not first-party — though consistent with the developer-stated 400 m level cap. Asserted throughout this document for want of a better number.
- **Teardown's "5 cm texture resolution / 10 cm octree cells"** (2018 blog) versus the shipped renderer's one-texel-per-voxel surface grain. **[disputed]**
- **Teardown engine licensing:** no public programme exists, but I found no explicit refusal either.
- **Teardown lifetime unit sales** beyond ~1.1M copies (2022) and ~2.5M players (post-Nov-2023). Aggregator estimates of 5–11M are modelled.
- **Atomontage's cumulative funding** — $1.2M / $1.95M / $3.5M / $4.5M / $5.53M all appear in sources. **[disputed]**
- **John Lin's status since August 2023.** No evidence of any 2025–26 activity. Do not claim he is active.
- **Enshrouded's meshing algorithm** — unpublished. No source names marching cubes, dual contouring, surface nets or transvoxel.
- **Vintage Story's current sales.** Only primary datum is 20,000+ as of November 2020.
- **Astroneer's voxel cell resolution** — never published. The widely-cited 2015 Transvoxel/octree blog predates Early Access and is speculation.
- **No Man's Sky's terrain edit cap** — the ~15,000 / 30,000 figures are community save-editor research; Hello Games has never stated a number.
- **Hytale's ">$100M spent"** — no source, no filing, no named insider. And **"2.8M launch-day players" is confirmed fabricated** (spoofed in-game chat message).
- **The Sandbox's "few hundred DAU"** — single-source journalistic characterisation, not a disclosed metric. Never repeat on stage.
- **SAND price / market cap** — live sources returned contradictory figures on 17–18 August 2026. **[disputed]**
- **Ace of Spades' Blitz Games handover date** — the commonly cited "November 2012, eight weeks" does not fit a 12 December ship date. **[disputed]**
- **DOIs for three of the four 2025–26 CGF/TOG voxel rendering papers** (Aokana is fully verified; the others surfaced via citation lists).
- **Columbus Nova causation** in the EQN cancellation. The timeline is documented; the causal claim is not.
- **The "jam as investment qualifying round" reading** in Part 0 is my inference from *"considered for."* It drives §3.3's framing advice, so weigh it as inference.

**Method note:** the research session exhausted its web-search budget partway through. Later findings were verified by direct fetch of primary sources (GitHub raw/API, project sites, docs, ContentDB, company announcements). A handful of domains were unreachable from the research environment and are flagged above.

---

## Appendix B — Key sources

**Hackathon / platform**

- [Creative Minds Jam #1 announcement, Animoca Brands, 23 Jul 2026](https://www.animocabrands.com/announcement/the-sandbox-and-animoca-brands-launch-creative-minds-jam-1-hong-kong-usd10000-agentic-ai-competition)
- [Minds US$10M investment programme, Animoca Brands, 5 May 2026](https://www.animocabrands.com/announcement/animoca-brands-launches-up-to-us-10m-investment-programme-for-developers-building-with-persistent-ai-agent-platform-minds)
- [build.hellominds.ai/program](https://build.hellominds.ai/program) · [hellominds.ai](https://www.hellominds.ai/) · [dorahacks.io/hackathon/creativeminds](https://dorahacks.io/hackathon/creativeminds/detail)
- [The Sandbox 3.0 vision, Robby Yung, Sep 2025](https://www.sandbox.game/en/blog/An-Update-on-Our-Vision-and-the-Road-Ahead/3499/) · [The Sandbox Game Maker docs](https://docs.sandbox.game/en/creator/game-maker/docs)
- [The Sandbox restructuring, CoinDesk, Aug 2025](https://www.coindesk.com/business/2025/08/28/the-sandbox-cuts-50-staff-restructures-as-animoca-brands-take-control)

**Teardown**

- [blog.voxagon.se](https://blog.voxagon.se/) — Gustafsson's blog; especially [From screen space to voxel space](https://blog.voxagon.se/2018/10/17/from-screen-space-to-voxel-space.html), [Teardown design notes](https://blog.voxagon.se/2020/11/05/teardown-design-notes.html), [The Spraycan](https://blog.voxagon.se/2020/12/03/spraycan.html), [Teardown multiplayer](https://blog.voxagon.se/2026/03/13/teardown-multiplayer.html)
- [Teardown frame breakdown, Juan Diego Montoya](https://juandiegomontoya.github.io/teardown_breakdown.html) · [A Teardown of Teardown, acko.net](https://acko.net/blog/teardown-frame-teardown/)
- [80.lv interview, 17 Mar 2026](https://80.lv/articles/teardown-developer-breaks-down-multiplayer-and-voxel-destruction-tech)
- [Teardown modding docs](https://get-teardown.readthedocs.io/en/latest/mods/creating-your-own-assets.html)

**Other engines and games**

- [John Lin, "The Perfect Voxel Engine"](https://voxely.net/blog/the-perfect-voxel-engine/)
- [Douglas Dwyer, octo-release](https://github.com/DouglasDwyer/octo-release)
- [Miguel Cepero on EQNext, Aug 2013](https://procworld.blogspot.com/2013/08/everquest-next.html)
- [Holly Longdale on EQN's failure, Variety, Mar 2019](https://variety.com/2019/gaming/features/to-survive-everquest-must-honor-past-embrace-future-1203169740/)
- [Game Over For Storybricks, TechCrunch, Mar 2015](https://techcrunch.com/2015/03/08/game-over/)
- [Closing the book on EverQuest Next and Landmark, EQ2Wire](https://eq2wire.com/2017/01/05/closing-the-book-on-everquest-next-and-landmark/)
- [Hytale Summer 2022 development update](https://hytale.com/news/2022/7/summer-2022-development-update) · [Collins-Laflamme on the salvage, PC Gamer, Jan 2026](https://www.pcgamer.com/games/adventure/its-a-damn-miracle-we-were-able-to-salvage-hytale-original-co-founder-and-new-owner-simon-collins-laflamme-says-after-years-in-development-at-riot-it-was-barely-playable/)
- [Astroneer: what the devs learned leaving Early Access, Game Developer, Apr 2019](https://www.gamedeveloper.com/design/what-i-astroneer-i-s-devs-learned-while-leaving-early-access)
- [Veloren voxel model guide](https://book.veloren.net/contributors/artists/voxel-models.html)
- [Aokana: GPU-Driven Voxel Rendering, arXiv 2505.02017](https://arxiv.org/abs/2505.02017)

**Assets and tools**

- [Mini Mike's Metro Minis (CC BY 4.0)](https://github.com/mikelovesrobots/mmmm)
- [MagicaVoxel, ephtracy](https://ephtracy.github.io/) — current 0.99.7.2, dated 7/12/2025
- [Lospec palette list](https://lospec.com/palette-list)
- [Luanti releases](https://github.com/luanti-org/luanti/releases) · [Luanti HTTP API docs](https://docs.luanti.org/for-creators/api/http-api/) · [openai_api mod](https://content.luanti.org/packages/cora/openai_api/)
- [blender_magicavoxel importer](https://extensions.blender.org/add-ons/blender-magicavoxel/)
