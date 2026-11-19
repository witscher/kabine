// Product photos are shrunk on the device before the upload: at most 800 px on the long side, WebP (JPEG where the
// browser cannot, e.g. Safari), at most 300 KB. Like profile pictures they are stored in D1 (README).
import { t } from "@lingui/core/macro";

const MAX_SIDE = 800;
const MAX_BYTES = 300_000;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t`The picture could not be opened. Please choose a photo in JPEG, PNG, WebP or HEIC format.`));
    };
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function shrinkImage(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55]) {
    const webp = await toBlob(canvas, "image/webp", quality);
    const blob = webp?.type === "image/webp" ? webp : await toBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error(t`The photo is too large.`);
}
