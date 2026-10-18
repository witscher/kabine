// Neuigkeit auf der Terminübersicht: gilt bis zum Ablaufdatum und nur, bis sie weggeklickt wurde.
import { describe, expect, it } from "vitest";
import { activeMotd, type Motd, motdStorageKey } from "../shared/motd";

const motd: Motd = { id: "test-1", until: "2026-11-30", title: "Neu", text: "Text" };

describe("Neuigkeit", () => {
  it("bis einschließlich zum letzten Tag, danach nicht mehr", () => {
    expect(activeMotd(motd, "2026-10-17", () => false)).toBe(motd);
    expect(activeMotd(motd, "2026-11-30", () => false)).toBe(motd);
    expect(activeMotd(motd, "2026-12-01", () => false)).toBeNull();
  });

  it("weggeklickt bleibt weg, eine neue id erscheint wieder", () => {
    const dismissed = new Set([motdStorageKey("test-1")]);
    const isDismissed = (id: string) => dismissed.has(motdStorageKey(id));
    expect(activeMotd(motd, "2026-10-17", isDismissed)).toBeNull();
    expect(activeMotd({ ...motd, id: "test-2" }, "2026-10-17", isDismissed)).not.toBeNull();
    expect(activeMotd(null, "2026-10-17", () => false)).toBeNull();
  });
});
