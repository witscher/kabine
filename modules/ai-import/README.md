# AI list import

Help for the list import in the setup wizard (`src/list-import.tsx`), for clubs whose lists are messy: unusual column headers, or names the rules cannot split (“Anna Lena Beispiel”, “Muster Kim (14)”). It uses Cloudflare's extraction model [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) through the club's own Workers AI binding. Its text answers are parts of the input, so it cannot invent a name, and each answer has a confidence; unsure answers are left to the admin.

The import works without this module. The module only adds two buttons, and nothing is sent until an admin taps one:

- **Recognise columns with AI** sends the column headers of one sheet; for columns without a header, up to three example entries.
- **Read names with AI** sends the name cells marked “check”, as they are written in the list (up to 100 per request).

Results are suggestions: they are marked “AI, check” in the review, and nothing is saved before the admin confirms the import.

- **Stores:** nothing. Requests are answered right away and not logged by Kabine.
- **Who sees it:** Cloudflare processes the text in the club's account. Per [Cloudflare's data usage terms](https://developers.cloudflare.com/workers-ai/platform/data-usage/) it is not used for training and not kept after processing. Processing in the EU is **not** guaranteed.
- **Costs:** Workers AI bills Clairic by input tokens (USD 0.10 per million); a whole club's lists cost well under a cent.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/routes.ts` | `POST /api/ai-import/columns`, `POST /api/ai-import/names` (admins) |
| `worker/clairic.ts` | the model call |
| `app/index.tsx` | hook `listImport` (src/module-api.ts) |
| `test/ai-import.test.ts` | API tests, model mocked |
