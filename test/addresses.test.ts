import { describe, expect, it } from "vitest";
import { isWorkersDevHost } from "../shared/addresses";

describe("isWorkersDevHost", () => {
  it("recognises Cloudflare's test address, not club domains", () => {
    expect(isWorkersDevHost("kabine.musterverein.workers.dev")).toBe(true);
    expect(isWorkersDevHost("KABINE.MUSTERVEREIN.WORKERS.DEV.")).toBe(true);
    expect(isWorkersDevHost("app.sv-musterstadt.de")).toBe(false);
    expect(isWorkersDevHost("workers.dev.example.org")).toBe(false);
    expect(isWorkersDevHost("localhost")).toBe(false);
  });
});
