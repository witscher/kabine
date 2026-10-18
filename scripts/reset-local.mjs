// Resets the local database: migrations and demo data.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync(".wrangler/state/v3/d1", { recursive: true, force: true });
rmSync(".wrangler/state/v3/kv", { recursive: true, force: true });
rmSync(".wrangler/state/v3/do", { recursive: true, force: true });
execSync("npx wrangler d1 migrations apply DB --local", { stdio: "inherit" });
execSync("npx wrangler d1 execute DB --local --file seed/demo.sql", { stdio: "inherit" });
