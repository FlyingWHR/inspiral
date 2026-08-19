# `creator` fixture — the un-hinted case

Invented account. There is deliberately **no `hints.json`** here: this fixture
exists to show what onboarding produces from raw items alone, with nothing
pre-extracted — one character derived from the profile, themes derived from
hashtags and word frequency, lore derived from the highest-engagement items.

That is what a real social handle looks like on day one, and it is thin. The
gap between this and `fixtures/tradeclash` is exactly the work the Mind has to
do on a real account.

```bash
npm run onboard -- --fixture creator
```
