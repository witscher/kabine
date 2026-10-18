// Startanimation einmal am Tag
import { describe, expect, it } from "vitest";
import { shouldShowSplash } from "../shared/inactivity";

describe("Startanimation", () => {
  it("beim ersten Öffnen eines Tages, danach nicht mehr", () => {
    expect(shouldShowSplash(null, "2026-10-10")).toBe(true);
    expect(shouldShowSplash("2026-10-09", "2026-10-10")).toBe(true);
    expect(shouldShowSplash("2026-10-10", "2026-10-10")).toBe(false);
  });
});
