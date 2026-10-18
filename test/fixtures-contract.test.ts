// The contract every fixture connector keeps (docs/connectors.md), checked with the samples its module
// records in modules/<folder>/samples/: links.json (links a coach would paste, with the expected source)
// and any other *.json (responses of the source). A new connector only has to pass it.
import { describe, expect, it } from "vitest";
import type { WorkerModule } from "../worker/module-api";

const workers = import.meta.glob<{ default: WorkerModule }>("../modules/*/worker/index.ts", { eager: true });
const samples = import.meta.glob<unknown>("../modules/*/samples/*.json", { eager: true, import: "default" });

const folderOf = (path: string) => path.split("/")[2]!;
const connectors = Object.entries(workers)
  .filter(([, m]) => m.default.fixtures)
  .map(([path, m]) => ({ folder: folderOf(path), id: m.default.manifest.id, vendor: m.default.manifest.vendor, connector: m.default.fixtures! }));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

describe.each(connectors)("fixture connector $id", ({ folder, id, vendor, connector }) => {
  const files = Object.entries(samples).filter(([path]) => folderOf(path) === folder);
  const links = (files.find(([path]) => path.endsWith("/links.json"))?.[1] ?? []) as { link: string; source: Record<string, unknown> }[];
  const responses = files.filter(([path]) => !path.endsWith("/links.json"));

  it("records samples: links.json and at least one response", () => {
    expect(links.length, `modules/${folder}/samples/links.json`).toBeGreaterThan(0);
    expect(responses.length, `modules/${folder}/samples/*.json`).toBeGreaterThan(0);
  });

  it("is fair to its source and explains itself", () => {
    expect(connector.name.trim()).not.toBe("");
    expect(vendor, "manifest vendor = connector name").toBe(connector.name);
    expect(connector.minIntervalMs, "at least one minute between syncs of a team").toBeGreaterThanOrEqual(60_000);
    const field = connector.linkField();
    for (const v of [field.label, field.hint, field.placeholder]) expect(v.trim()).not.toBe("");
  });

  it("recognises its links and only those", () => {
    for (const { link, source } of links) {
      expect(connector.parseLink(link), link).toEqual(source);
      expect(connector.describe(source as never).trim()).not.toBe("");
      expect(connector.request(source as never).url).toMatch(/^https:\/\//);
      const table = connector.tableUrl?.(source as never);
      if (table) expect(table).toMatch(/^https:\/\//);
    }
    for (const other of ["https://example.org/league?id=1", "no link", ""]) expect(connector.parseLink(other), other).toBeNull();
  });

  it.each(responses.map(([path, data]) => ({ path, data })))("reads $path", ({ data }) => {
    const schedule = connector.parse(data, links[0]!.source as never);
    expect(schedule.games.length).toBeGreaterThan(0);
    const ids = schedule.games.map((g) => g.externalId);
    expect(new Set(ids).size, "unique game ids").toBe(ids.length);
    for (const g of schedule.games) {
      expect(g.externalId, "id without ':'").toMatch(/^[^:\s]+$/);
      expect(g.date).toMatch(DATE);
      expect(Number.isNaN(Date.parse(`${g.date}T00:00:00Z`))).toBe(false);
      expect(g.time).toMatch(TIME);
      expect(g.home.trim()).not.toBe("");
      expect(g.guest.trim()).not.toBe("");
      if (g.venue) expect(g.venue.externalId).toMatch(/^[^:\s]+$/);
      for (const goals of [g.homeGoals, g.guestGoals]) if (goals != null) expect(Number.isInteger(goals) && goals >= 0).toBe(true);
    }
    expect(id).toBeTruthy();
  });
});

it("finds the connectors", () => {
  expect(connectors.map((c) => c.id)).toContain("handball4all");
});
