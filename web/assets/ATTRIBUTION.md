# Third-party assets

Nothing in this directory was modelled for Inspiral. Both packs are CC0 (public
domain) by Kenney — no attribution is legally required; it is here because it
is the decent thing to do.

| Directory     | Pack                        | Source                                  | License |
| ------------- | --------------------------- | --------------------------------------- | ------- |
| `castle/`     | Castle Kit 2.0              | https://kenney.nl/assets/castle-kit      | CC0 1.0 |
| `characters/` | Mini Characters             | https://kenney.nl/assets/mini-characters | CC0 1.0 |

Only the files the ward actually uses were vendored (18 building pieces, 4
character bodies, 2 shared `colormap.png` texture atlases) — 1.3 MB total, so
the demo has no download step and no asset pipeline.

The buildings are **assembled from kit pieces at runtime** (base → mid → roof,
stacked by measured bounding box) rather than modelled. The character GLBs are
rigged and ship 32 clips each; the surface uses `idle`, `walk`, `emote-yes`,
`emote-no` and `interact-right`.
