import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { germanClub } from "./helpers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// The tests check German texts: the test club speaks German unless a test says otherwise
await germanClub();
