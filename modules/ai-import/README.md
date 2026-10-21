# AI list import

Help for the list import in the setup wizard (`src/list-import.tsx`), for lists with unusual column headers or columns without one. It uses Cloudflare's extraction model [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) through the club's own Workers AI binding. The import works without this module; the module only adds the button **Recognise columns with AI** to each list, and nothing is sent until an admin taps it.

## What is sent

Only what `assistInput` in `shared/list-import.ts` lets through, never a readable name or birth year:

- the column headers of the list ("Vorname", "Jg.", "Funktion");
- for columns without a header, up to three example entries, **masked**: every letter becomes X or x, digits and punctuation stay ("Xxxxxx, Xxxx", "xX1", "2014");
- if the list has no recognisable header row, its first row may be a person, so the headers are masked as well.

Names are split by fixed rules in the browser; what they cannot split stays marked "check" for the admin. Clairic's answers are suggestions: they fill only columns that are still on "Ignore", unsure answers are dropped, and the admin sees example values next to every column before reading the list.

Why not more: Clairic is a preview, Cloudflare's terms exclude training only for generative AI (Clairic is an extraction model), and Workers AI cannot be limited to the EU (sub-processors CoreWeave, USA, and Nebius, England). Most players are children. Sending names in plain text would need written answers from Cloudflare first.

## Data protection

- **Stores:** nothing. Requests are answered right away; the module writes no cell contents or answers to logs or error messages.
- **Cloudflare:** per its [data usage page](https://developers.cloudflare.com/workers-ai/platform/data-usage/) (16 October 2026) Workers AI keeps no inputs or outputs after a request (zero data retention) and does not use them for training, with exceptions for legal and safety reasons whose scope Cloudflare does not describe. The module calls the binding without an AI Gateway, so no gateway log is written; do not route it through one. Processing in the EU is not guaranteed.
- **For the club:** switching the module on is the club's decision as controller. Add it to the records of processing activities; the column headers are usually not personal data.
- **Costs:** Workers AI bills Clairic by input tokens (USD 0.10 per million); a whole club's lists cost well under a cent.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/routes.ts` | `POST /api/ai-import/columns` (admins) |
| `worker/clairic.ts` | the model call |
| `app/index.tsx` | hook `listImport` (src/module-api.ts) |
| `test/ai-import.test.ts` | API tests, model faked |
