// The contract every module keeps (docs/dev/modules.md). Runs for all modules, also the ones added later,
// so a new module only has to pass it. Invented names only.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import modulesDoc from "../docs/dev/modules.md?raw";
import type { ModuleManifest } from "../shared/module-api";
import { DEFAULT_MODULES, MODULES, moduleOfPath } from "../shared/modules";
import { saveClub } from "../worker/domain/club";
import { WORKER_MODULES } from "../worker/modules";
import { api, freshDb, germanClub } from "./helpers";

const manifests: readonly ModuleManifest[] = MODULES;

/** A path of a Hono route with every parameter filled in: "/events/:id/carpool" → "/api/events/1/carpool". */
const concrete = (path: string) => `/api${path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, "1").replace(/\*$/, "x")}`;

describe("module manifests", () => {
  it("are complete and consistent", async () => {
    await germanClub();
    const ids = manifests.map((m) => m.id);
    expect(new Set(ids).size, "ids unique").toBe(ids.length);
    for (const m of manifests) {
      expect(m.id, "camelCase id").toMatch(/^[a-z][a-zA-Z0-9]*$/);
      if (m.requires) expect(ids, `${m.id}: requires`).toContain(m.requires);
      if (m.status === "beta") expect(m.defaultOn, `${m.id}: beta modules start switched off`).toBe(false);
      expect(m.label().trim(), `${m.id}: label`).not.toBe("");
      expect(m.description().trim(), `${m.id}: description`).not.toBe("");
      const privacy = m.privacy();
      if (privacy) for (const [k, v] of Object.entries(privacy)) expect(v.trim(), `${m.id}: privacy.${k}`).not.toBe("");
      for (const topic of m.notificationTopics ?? []) expect(topic.label().trim(), `${m.id}: topic ${topic.id}`).not.toBe("");
      expect(modulesDoc, `${m.id}: row in docs/dev/modules.md`).toContain(`| \`${m.id}\` |`);
      expect(DEFAULT_MODULES[m.id as keyof typeof DEFAULT_MODULES]).toBe(m.defaultOn);
    }
  });

  it("every worker part belongs to a registered module", () => {
    const ids = WORKER_MODULES.map((m) => m.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of WORKER_MODULES) {
      expect(manifests, `${m.manifest.id} is listed in modules/index.ts`).toContain(m.manifest);
      if (m.routes) expect(m.manifest.paths?.length, `${m.manifest.id}: routes need paths in the manifest`).toBeGreaterThan(0);
      if (m.fixtures) expect(m.manifest.kind, `${m.manifest.id}: a connector is a module of kind "fixtures"`).toBe("fixtures");
    }
  });
});

describe("module routes", () => {
  beforeEach(freshDb);

  const routes = WORKER_MODULES.flatMap((m) => (m.routes?.routes ?? []).filter((r) => r.method !== "ALL").map((r) => ({ id: m.manifest.id, method: r.method, path: r.path })));

  it("lie inside the module's paths", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(moduleOfPath(concrete(r.path)), `${r.method} ${r.path} (${r.id})`).toBe(r.id);
  });

  it("answer 404 while the module is off", async () => {
    await saveClub(env.DB, { modules: Object.fromEntries(manifests.map((m) => [m.id, false])) as typeof DEFAULT_MODULES });
    for (const r of routes) {
      const res = await api(concrete(r.path).slice(4), { method: r.method, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.path} (${r.id})`).toBe(404);
      expect(res.body.error.code).toBe("module_off");
    }
  });
});
