# Screens

Captured from a live `npm run world` on 19 Aug 2026 at 1600×900, mock host, no
API key. Nothing is mocked up or composited: every frame is the running app.

| File | What it shows |
| ---- | ------------- |
| `01-ward-establishing.png` | The set. Plaza, three towers, ward wall, trees — all assembled at runtime from Kenney CC0 kit pieces, lit with soft shadows and GTAO ambient occlusion. The three seeded characters stand at their buildings. |
| `02-characters-speaking.png` | Okonkwo has walked across the plaza to Sera Vance and is snubbing her, in a speech bubble, with nameplates. The tick loop chose that; the surface only staged it. |
| `03-citation-resolved.png` | **The money shot.** Wren (blue nameplate, the visitor) returns after days away. Okonkwo greets them as an ally and the bubble prints the receipt: `✓ evt_mmn6gow0_0037` resolved against the append-only log. The feed on the left shows Sera Vance snubbing Wren for having taken the other side. |
| `04-mint-paste-a-sheet.png` | The mint panel: paste a character sheet as text. Keys are optional; a bare paragraph works. |
| `05-minted-npc-in-world.png` | Halric Vaas, Wharfmaster, seconds after being minted — standing in the plaza with his own body, alongside the seeded cast and the visitor. |
| `06-chat-surface-same-canon.png` | `npm run chat` attached to the **same running world**: same cast including the minted Halric Vaas, same visitor, and the same event id `evt_mmn6gow0_0037` with the same resolved receipt. Two surfaces, one canon. Real terminal output, rendered to PNG for legibility. |

## Honest notes

- The camera in 02, 03 and 05 was moved from the default — the same drag/scroll
  a viewer does. The default opening view is 01.
- In 03 the speaker's own nameplate sits behind his speech bubble. Cosmetic.
- The ground is a flat untextured plane. It reads a little bare in 01.
- The dialogue is rule-based mock prose and repeats over long runs. That is the
  placeholder, not a rendering problem — see README > "Placeholder: the Minds
  host".
