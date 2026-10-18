# Translation

Kabine is written in English (source language) and translated with [Lingui](https://lingui.dev). Catalogs are gettext files in `locales/`: `en.po` (source) and `de.po` (German). People correct translations directly in the `.po` files.

## For translators

- Edit `msgstr` in `locales/<language>.po`. Keep placeholders such as `{name}` and tags such as `<0>…</0>` exactly as in `msgid`; they may move within the sentence.
- Plurals use ICU: `{count, plural, one {# player} other {# players}}`. Translate the words inside the braces, keep the structure.
- Entries written by a machine carry the translator comment `#. ai`. When you have checked or corrected one, delete that line. Machine translation never overwrites an entry without the marker, unless its English source changed.
- New language: add it to `LOCALES` in `shared/i18n.ts` and `lingui.config.ts`, add a catalog loader in `src/i18n.ts` and `worker/i18n.ts`, run `npm run i18n`.

## For developers

Every text a person reads goes through Lingui. Write English.

```tsx
import { t, plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

const title = t`Training cancelled`;                     // in code and attributes
<Trans>No events in the <strong>next two weeks</strong>.</Trans> // JSX with markup
const label = plural(count, { one: "# player", other: "# players" });
```

Rules:

- **Inside functions only.** Never call `t`, `plural` or `<Trans>` at module scope: the language is set after the modules are loaded. Lists of labels become functions (`const topics = () => [...]`).
- **Named placeholders.** Interpolate plain variables, not expressions: `const name = person.firstName; t\`Hello ${name}\`` gives `Hello {name}`; `${person.firstName}` would give `{0}`, which translators cannot read.
- **Whole sentences.** Do not glue sentences from pieces; word order differs between languages. Use one message with placeholders.
- **Context** when one English word has two meanings: `t({ message: "Squad", context: "nomination" })`.
- **Not translated:** names, data, codes, routes, CSS classes, storage keys, log messages for developers (`console.*`).
- **Dates and times:** `src/format.ts` (app) and `shared/dates.ts` (worker), never hand-written month or weekday names.

### Server texts

The worker translates in the language of the current request (account setting, else the app's language sent in `x-kabine-locale`, else the club default). `t` in worker code needs no setup.

Texts for other people go out in *their* language:

- Push: pass a function, it runs once per recipient language: `notifyPersons(env, ids, "events", () => ({ title: t\`Game moved\`, body, url }), opts)`.
- Mail or anything else per recipient: `withLocale(account.locale, () => …)` from `worker/i18n.ts`.
- Zod messages are created once, so use the function form: `z.string().min(1, { error: () => t\`Please enter a name.\` })`.
- Durable Objects (chat, helper plan) run outside the request: they get the language in a header from the route, or use the club default.

### Workflow

```sh
npm run i18n          # extract messages into the catalogs, fill German from locales/de/*.json, check
npm run i18n:check    # CI: every message translated, placeholders match
```

`locales/de/*.json` holds German translations by English message (`{ "Send code": "Code senden" }`), one file per area. `node tools/i18n-msgids.mjs <files>` prints the messages of source files exactly as they appear in the catalog, so the keys match. After `npm run i18n` the `.po` file is the reference; the JSON files only fill empty entries.
