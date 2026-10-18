# Modules – local contract

One folder per module; read [docs/dev/modules.md](../docs/dev/modules.md) for the hooks and [docs/dev/connectors.md](../docs/dev/connectors.md) for game schedule sources.

- `module.ts` is pure data (`defineModule`); `worker/` only imports from `worker/`, `shared/` and this module; `app/` only from `src/`, `shared/` and this module. A module may import from a module it `requires`, never from others.
- Register the manifest in `modules/index.ts` (the generator does it). Worker and app parts are found by the build.
- Every API route matches the manifest's `paths`; while the module is off it answers 404 (`test/modules-contract.test.ts`).
- Personal data: declare it in `privacy()`, export its tables (`exportTables`), clean up in `personLeaves` and, if it hangs on participants, `participantsDropped`.
- New modules start as `status: "beta"`, `defaultOn: false`.
- Tests live in `<module>/test/`, invented names only; use the helpers in `test/helpers.ts`.
- Reference modules: `carpools/` (event hooks, cleanup), `handball4all/` (fixture connector, game links), `sms/` (provider, text channel, admin page).
