# __VENDOR__

Game schedules from __VENDOR__ (https://www.__DOMAIN__).

- **Access:** which interface, and why it may be used (official API, public export, permission of the association). Link the terms of use.
- **Fetched by:** the server (`fetchFrom: "worker"`) or the coach's device, and why.
- **Data:** games, halls, results. No personal data.
- **Samples:** where `samples/schedule.json` comes from (invented, or a public schedule with personal data removed).

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/connector.ts` | links, request, parsing |
| `worker/index.ts` | registers the connector |
| `samples/` | links and recorded responses for test/fixtures-contract.test.ts |
| `test/__FOLDER__.test.ts` | tests of what is special about this source |
