// Polls module, orders: quantities per item and size and the Excel export (app/order-export.ts, app/xlsx.ts).
// The file structure is read back here with a small ZIP reader; names invented.
import { describe, expect, it } from "vitest";
import { withLocale } from "../../../worker/i18n";
import { moneyFormat, orderFilename, orderQuantities, orderSheets } from "../shared/order-export";
import { columnName, crc32, xlsx } from "../shared/xlsx";
import type { PollDetail } from "../types";

const detail = {
  options: [
    { id: 1, label: "T-Shirt", startsAt: null, priceCents: 1500, sizes: ["M", "L", "XL"], imageUrl: null },
    { id: 2, label: "Mütze", startsAt: null, priceCents: 1000, sizes: [], imageUrl: null },
  ],
  orders: [
    {
      unitId: 1,
      orderNo: 1,
      label: "Familie Kaiser: Ben (mC) & <Kim>",
      items: [
        { optionId: 1, size: "XL", quantity: 2 },
        { optionId: 2, size: "", quantity: 1 },
      ],
      totalCents: 4000,
      paid: false,
      paidCents: 2500,
      reportedCents: 4000,
    },
    {
      unitId: 2,
      orderNo: 2,
      label: "Lea Lang (wD)",
      items: [
        { optionId: 1, size: "XL", quantity: 1 },
        { optionId: 1, size: "M", quantity: 1 },
      ],
      totalCents: 3000,
      paid: true,
      paidCents: 3000,
      reportedCents: 0,
    },
    { unitId: 3, orderNo: null, label: "Familie Ost: Ole", items: [], totalCents: 0, paid: false, paidCents: 0, reportedCents: 0 },
  ],
} as unknown as PollDetail;

/** Reads the entries of a ZIP with stored entries through the central directory, checking sizes and CRC. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    expect(view.getUint16(pos + 10, true)).toBe(0); // stored
    const crc = view.getUint32(pos + 16, true);
    const size = view.getUint32(pos + 20, true);
    expect(view.getUint32(pos + 24, true)).toBe(size);
    const nameLen = view.getUint16(pos + 28, true);
    const local = view.getUint32(pos + 42, true);
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, dec.decode(data));
    pos += 46 + nameLen + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
  return out;
}

describe("Bestellung: Mengen und Excel-Export", () => {
  it("zählt je Artikel und Größe in der Reihenfolge der Artikel und Größen", () => {
    expect(orderQuantities(detail).map((l) => [l.option.label, l.size, l.quantity])).toEqual([
      ["T-Shirt", "M", 1],
      ["T-Shirt", "XL", 3],
      ["Mütze", "", 1],
    ]);
  });

  it("drei Blätter: Mengen mit Summe, Bestellungen mit Bezahlstand, Positionen; ohne „nichts bestellt“", () => {
    const [quantities, orders, lines] = withLocale("de", () => orderSheets(detail));
    expect(quantities!.name).toBe("Mengen");
    expect(quantities!.rows[0]).toEqual(["Artikel", "Größe", "Menge", "Einzelpreis", "Betrag"]);
    expect(quantities!.rows[2]).toEqual(["T-Shirt", "XL", 3, { cents: 1500 }, { cents: 4500 }]);
    expect(quantities!.rows.at(-1)).toEqual(["Summe", "", 5, null, { cents: 7000 }]);
    expect(orders!.name).toBe("Bestellungen");
    expect(orders!.rows[0]).toEqual(["Nr.", "Name", "Bestellt", "Betrag", "Bezahlt", "Gemeldet", "Offen"]);
    expect(orders!.rows).toHaveLength(3);
    expect(orders!.rows[1]).toEqual([1, "Familie Kaiser: Ben (mC) & <Kim>", "2× T-Shirt XL, 1× Mütze", { cents: 4000 }, { cents: 2500 }, { cents: 4000 }, { cents: 1500 }]);
    expect(lines!.name).toBe("Positionen");
    expect(lines!.rows).toHaveLength(5);
    expect(withLocale("en", () => orderSheets(detail))[0]!.name).toBe("Quantities");
  });

  it("ergibt eine gültige Arbeitsmappe: ZIP ohne Kompression, Teile, Blätter, Stile, fixierte Kopfzeile", () => {
    const bytes = withLocale("de", () => xlsx(orderSheets(detail), { moneyFormat: moneyFormat("EUR", "de-DE") }));
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const parts = unzip(bytes);
    expect([...parts.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]);
    for (const [, xml] of parts) expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(parts.get("[Content_Types].xml")).toContain('PartName="/xl/worksheets/sheet3.xml"');
    expect(parts.get("xl/workbook.xml")).toContain('<sheet name="Mengen" sheetId="1" r:id="rId1"/>');
    expect(parts.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    expect(parts.get("xl/styles.xml")).toContain('formatCode="#,##0.00 &quot;€&quot;"');
    const orders = parts.get("xl/worksheets/sheet2.xml")!;
    expect(orders).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    // Header bold (style 1), texts escaped inline, amounts as numbers with the money style (2)
    expect(orders).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Nr.</t></is></c>');
    expect(orders).toContain("Familie Kaiser: Ben (mC) &amp; &lt;Kim&gt;");
    expect(orders).toContain('<c r="D2" s="2"><v>40</v></c>');
    expect(orders).toContain('<c r="A2"><v>1</v></c>');
  });

  it("Spaltennamen, Währungsformat und Dateiname nur aus ASCII", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(moneyFormat("CHF", "de-CH")).toBe('#,##0.00 "CHF"');
    expect(moneyFormat("XYZ1", "de-DE")).toBe('#,##0.00 "XYZ1"');
    withLocale("de", () => {
      expect(orderFilename('Shirts: "neu"/2027', "2026-11-23")).toBe("Bestellung Shirts neu 2027 2026-11-23.xlsx");
      expect(orderFilename("Wintermütze & Schal für Groß – Café", "2026-11-23")).toBe("Bestellung Wintermuetze & Schal fuer Gross Cafe 2026-11-23.xlsx");
      expect(orderFilename("🧢", "2026-11-23")).toBe("Bestellung Poll 2026-11-23.xlsx");
    });
    expect(withLocale("en", () => orderFilename("Club kit", "2026-11-23"))).toBe("Order Club kit 2026-11-23.xlsx");
  });
});
