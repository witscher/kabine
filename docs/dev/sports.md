# Sports

A sport profile is plain data in `sports/<id>.ts`. It gives a new club sensible defaults in the setup wizard; admins adjust everything afterwards under *Administration*. Kabine has profiles for handball, football and a generic "other sport". Adding one is a good first contribution.

## What a profile controls

| Field | Used for |
| --- | --- |
| `id` | Stored in the club profile. Lowercase, never renamed later. |
| `name` | The sport in the setup wizard, in every language of `shared/i18n.ts`. |
| `seasonStart` | Default first day of a season (setup wizard, season change). |
| `venue` | Where the sport is played: `hall` (handball, basketball, volleyball), `pitch` (football) or `venue` for neutral wording. Texts that name the place (club venues, "hall unavailable", the venue column of the game table) pick their wording from it with ICU `select`; translators write each case. |
| `ageClasses` | Age classes of the federation: code, name per language, `rank` (young to old), `youth`, `ageFrom`/`ageTo` (ages reached in the calendar year the season starts in), `gameMinutes` (how long a game blocks the hall: helper duty blocks, "live" window), optional `youthReferee` (home games get a youth referee duty, only with the youth referee module). |
| `dutyTypes` | Helper duties the club starts with: `onsite` at the game or a `task` around it, who may take it (parents, youth referees), whether a note is allowed (which cake) or a skill is needed (timekeeper). `DUTY_KIOSK` and `DUTY_SHIRTS` in `shared/sport-api.ts` are shared by most sports. |
| `homeTemplate`, `awayTemplate` | Duties every home or away game gets: duty code, number of slots, minutes before kick-off and after the end. |

Fixture connectors are not part of the profile: a connector module names the sports it serves in its manifest (`sports` in `modules/<name>/module.ts`).

## Adding a sport

```sh
npm run new -- sport basketball --name "Basketball" --name-de "Basketball"
```

This creates `sports/basketball.ts` from `templates/sport/sport.ts` and adds it to `sports/index.ts`. Then:

1. Fill in the age classes of the federation you know (say which one in the comment at the top, e.g. "Deutscher Basketball Bund"). Only the youngest class may be open downwards (`ageFrom: null`), only the oldest upwards; the ranges must follow each other without gaps.
2. Add the typical duties at a home game (scorers' table, 24-second clock, referees) and the templates.
3. Write the names in every language; they are part of the profile, not of the `.po` catalogs.
4. `npm run check`. `test/sports-contract.test.ts` tells you what is missing or inconsistent.

Example of an age class and a duty:

```ts
{ code: "U14", name: { en: "Under 14", de: "U14" }, rank: 2, youth: true, ageFrom: 12, ageTo: 13, gameMinutes: 90 },
{ code: "table", name: { en: "Scorers' table", de: "Kampfgericht" }, mode: "onsite", whoParents: true, needsSkill: true },
```

Sports differ between countries. If your federation's classes differ from an existing profile, say so in the pull request; a profile per country (`basketball-de`) is fine.
