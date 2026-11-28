// Mascot pictures are checked and scaled on the device before the upload, like profile pictures: PNG, WebP or SVG
// (drawn into a PNG or WebP here, so no SVG is stored), transparent or white background, at least 256 px on the
// longer side, square for the faces, at most about 200 KB. The server checks type and size again (worker/routes.ts).
import { t } from "@lingui/core/macro";
import type { MascotSlot } from "../../../shared/module-api";
import { MAX_BYTES, MIN_SIDE, SLOT_RULES } from "../shared/rules";

export const ACCEPT = "image/png,image/webp,image/svg+xml";

/** Share of the outer pixels that may be neither transparent nor white (a mascot may touch the edge here and there). */
const MAX_COLOURED_EDGE = 0.25;
/** Width and height may differ this much for a face; it is then drawn square. */
const SQUARE_TOLERANCE = 0.02;

const isSvg = (file: File) => file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t`The picture could not be opened. Please choose a PNG, WebP or SVG file.`));
    };
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Pixels on the outer two rows and columns that are neither (nearly) transparent nor (nearly) white, as a share. */
export function colouredEdge(data: Uint8ClampedArray, width: number, height: number): number {
  let checked = 0;
  let coloured = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x > 1 && x < width - 2 && y > 1 && y < height - 2) continue;
      const i = (y * width + x) * 4;
      checked++;
      const transparent = data[i + 3]! < 16;
      const white = data[i]! >= 235 && data[i + 1]! >= 235 && data[i + 2]! >= 235;
      if (!transparent && !white) coloured++;
    }
  }
  return checked ? coloured / checked : 0;
}

/** Draws the picture at the slot's size; PNG or WebP of at most MAX_BYTES, or an error to show. */
export async function prepareMascot(file: File, slot: MascotSlot): Promise<Blob> {
  const svg = isSvg(file);
  if (!svg && file.type !== "image/png" && file.type !== "image/webp") throw new Error(t`Please choose a PNG, WebP or SVG file.`);
  const img = await loadImage(file);
  // An SVG without its own size has none here; it is drawn at the slot's size anyway
  const w = img.naturalWidth || SLOT_RULES[slot].side;
  const h = img.naturalHeight || SLOT_RULES[slot].side;
  const side = MIN_SIDE;
  if (!svg && Math.max(w, h) < side) throw new Error(t`The picture must be at least ${side} pixels in size.`);
  const rule = SLOT_RULES[slot];
  if (rule.square && Math.abs(w - h) > SQUARE_TOLERANCE * Math.max(w, h)) throw new Error(t`The faces must be square.`);

  // Long side at the slot's size (never larger than the original, except for SVG), faces exactly square
  let long = svg ? rule.side : Math.min(rule.side, Math.max(w, h));
  for (;;) {
    const scale = long / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = rule.square ? long : Math.max(1, Math.round(w * scale));
    canvas.height = rule.square ? long : Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let pixels: ImageData;
    try {
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      throw new Error(t`The picture could not be opened. Please choose a PNG, WebP or SVG file.`);
    }
    if (colouredEdge(pixels.data, canvas.width, canvas.height) > MAX_COLOURED_EDGE) throw new Error(t`The background must be transparent or white.`);
    // WebP keeps the transparency; Safari cannot write WebP and gets PNG
    for (const quality of [0.9, 0.75]) {
      const webp = await toBlob(canvas, "image/webp", quality);
      if (webp?.type === "image/webp" && webp.size <= MAX_BYTES) return webp;
      if (webp?.type === "image/webp") continue;
      const png = await toBlob(canvas, "image/png");
      if (png && png.size <= MAX_BYTES) return png;
      break;
    }
    // Still too large: a bit smaller, down to the minimum
    if (long <= MIN_SIDE) throw new Error(t`The picture may be at most 200 KB.`);
    long = Math.max(MIN_SIDE, Math.round(long * 0.8));
  }
}
