// What a mascot picture must be, checked in the browser before the upload (app/prepare.ts) and again on the server
// (worker/routes.ts). No DOM, no worker APIs.
import { MASCOT_SLOTS, type MascotSlot } from "../../../shared/module-api";

/** At least this many pixels on the longer side, also after scaling. */
export const MIN_SIDE = 256;
/** At most this many bytes per picture (about 200 KB). */
export const MAX_BYTES = 200_000;
/** Types that are stored; the browser turns SVG into one of them. */
export const STORED_TYPES = ["image/png", "image/webp"] as const;
export type StoredType = (typeof STORED_TYPES)[number];

/** Per slot: square or any shape, and the longer side the browser scales down to. */
export const SLOT_RULES: Record<MascotSlot, { square: boolean; side: number }> = {
  win: { square: true, side: 256 },
  draw: { square: true, side: 256 },
  close: { square: true, side: 256 },
  clear: { square: true, side: 256 },
  card: { square: false, side: 512 },
  head: { square: false, side: 256 },
};

export const FACE_SLOTS = ["win", "draw", "close", "clear"] as const satisfies readonly MascotSlot[];

export function isMascotSlot(s: string): s is MascotSlot {
  return (MASCOT_SLOTS as readonly string[]).includes(s);
}

/** Type and size from the first bytes of a PNG or WebP file, not from what the upload declares; null for anything else. */
export function imageInfo(b: Uint8Array): { mime: StoredType; width: number; height: number } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  // PNG: signature, then the IHDR chunk with width and height (big endian)
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 4) === "PNG" && ascii(12, 16) === "IHDR") {
    const be = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    return { mime: "image/png", width: be(16), height: be(20) };
  }
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    // Extended format (with transparency): 24-bit sizes minus one
    if (chunk === "VP8X") return { mime: "image/webp", width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    // Lossy: 14-bit sizes after the frame tag
    if (chunk === "VP8 ") return { mime: "image/webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    // Lossless: 14-bit sizes minus one, packed after the signature byte
    if (chunk === "VP8L" && b[20] === 0x2f) {
      return { mime: "image/webp", width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) };
    }
  }
  return null;
}
