// Profile pictures: display, taking with the camera or choosing, cropping, approval.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { invalidate, useQuery } from "./store";
import { Avatar, Button, confirmDialog, Notice, Sheet, Spinner, toast } from "./ui";

/** Edge length of the stored picture in pixels. */
const OUTPUT = 256;
/** Size of the crop area on screen. */
const VIEW = 280;
const MAX_ZOOM = 4;

export function avatarUrl(personId: number, version: number, pending = false): string {
  return `/api/persons/${personId}/avatar?${pending ? "pending=1&" : ""}v=${version}`;
}

/** All approved pictures (personId → version), loaded once and shared. */
export function useAvatars(): Record<string, number> {
  return useQuery<{ avatars: Record<string, number> }>("/avatars").data?.avatars ?? {};
}

/** A person's avatar: picture if approved, otherwise the initial. */
export function PersonAvatar(props: { personId: number | null; name: string; coach?: boolean; size?: number }) {
  const avatars = useAvatars();
  const version = props.personId ? avatars[props.personId] : undefined;
  return <Avatar name={props.name} coach={props.coach} size={props.size} src={version && props.personId ? avatarUrl(props.personId, version) : null} />;
}

function refreshAvatars(personId: number) {
  invalidate("/avatars", `/persons/${personId}/avatar`);
}

// Cropping -------------------------------------------------------------------------

interface Crop {
  zoom: number;
  x: number;
  y: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t`The picture could not be opened. Please choose a photo in JPEG, PNG, WebP or HEIC format.`));
    };
    img.src = url;
  });
}

/** Scale at which the picture just fills the square area. */
function coverScale(img: HTMLImageElement): number {
  return VIEW / Math.min(img.naturalWidth, img.naturalHeight);
}

/** Limit the offset so that the whole area is always covered. */
function clamp(img: HTMLImageElement, crop: Crop): Crop {
  const scale = coverScale(img) * crop.zoom;
  const maxX = Math.max(0, (img.naturalWidth * scale - VIEW) / 2);
  const maxY = Math.max(0, (img.naturalHeight * scale - VIEW) / 2);
  return { zoom: crop.zoom, x: Math.min(maxX, Math.max(-maxX, crop.x)), y: Math.min(maxY, Math.max(-maxY, crop.y)) };
}

function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, crop: Crop, size: number) {
  const k = size / VIEW;
  const scale = coverScale(img) * crop.zoom * k;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, size / 2 + crop.x * k - w / 2, size / 2 + crop.y * k - h / 2, w, h);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Save as WebP where the browser can (Safari can't), otherwise as JPEG. */
async function exportImage(img: HTMLImageElement, crop: Crop): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  draw(canvas.getContext("2d")!, img, crop, OUTPUT);
  const webp = await toBlob(canvas, "image/webp", 0.85);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error(t`The picture could not be converted.`);
  return jpeg;
}

function CropSheet(props: { file: File; onClose: () => void; onSave: (blob: Blob) => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    let image: HTMLImageElement | null = null;
    loadImage(props.file).then(
      (i) => {
        image = i;
        setImg(i);
      },
      (err: Error) => setError(err.message),
    );
    return () => {
      if (image) URL.revokeObjectURL(image.src);
    };
  }, [props.file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = VIEW * ratio;
    canvas.height = VIEW * ratio;
    draw(canvas.getContext("2d")!, img, crop, VIEW * ratio);
  }, [img, crop]);

  const update = (next: Crop) => img && setCrop(clamp(img, { ...next, zoom: Math.min(MAX_ZOOM, Math.max(1, next.zoom)) }));

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      update({ ...crop, zoom: (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance });
      return;
    }
    // CSS may display the area smaller than VIEW
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const k = VIEW / rect.width;
    update({ ...crop, x: crop.x + (e.clientX - last.x) * k, y: crop.y + (e.clientY - last.y) * k });
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return (
    <Sheet open onClose={props.onClose} title={t`Crop picture`}>
      {error ? <Notice kind="warn">{error}</Notice> : null}
      {!img && !error ? <Spinner label={t`Loading picture`} /> : null}
      {img ? (
        <>
          <div
            class="crop-frame"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(e) => {
              e.preventDefault();
              update({ ...crop, zoom: crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) });
            }}
          >
            <canvas ref={canvasRef} aria-label={t`Profile picture preview`} />
            <div class="crop-mask" aria-hidden="true" />
          </div>
          <label class="crop-zoom">
            <span class="small muted">
              <Trans>Zoom</Trans>
            </span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onInput={(e) => update({ ...crop, zoom: Number((e.target as HTMLInputElement).value) })}
            />
          </label>
          <p class="small muted">
            <Trans>Move with your finger, zoom with two fingers or the slider.</Trans>
          </p>
          <Button variant="primary" size="lg" block icon="check" onClick={async () => props.onSave(await exportImage(img, crop))}>
            <Trans>Apply</Trans>
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

// Editing --------------------------------------------------------------------------

interface AvatarInfo {
  approved: number | null;
  pending: number | null;
  needsConsent: boolean;
  hasGuardians: boolean;
  canUpload: boolean;
  canApprove: boolean;
}

/**
 * Profile picture of the own person or a child. "self" is the person's view, "guardian" that of
 * a parent.
 */
export function AvatarEditor(props: { personId: number; name: string; view: "self" | "guardian" }) {
  const { data: info, reload } = useQuery<AvatarInfo>(`/persons/${props.personId}/avatar/info`);
  const [file, setFile] = useState<File | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const firstName = props.name.split(" ")[0];

  const changed = async () => {
    refreshAvatars(props.personId);
    await reload();
  };

  const onFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (f) setFile(f);
  };

  const save = async (blob: Blob) => {
    const res = await api.upload<{ status: "approved" | "pending" }>(`/persons/${props.personId}/avatar`, blob);
    setFile(null);
    toast(res.status === "pending" ? t`Saved. Your parents still need to approve the picture.` : t`Profile picture saved.`);
    await changed();
  };

  if (!info) return <Spinner />;

  const current = info.approved != null ? avatarUrl(props.personId, info.approved) : null;
  const pendingSrc = info.pending != null ? avatarUrl(props.personId, info.pending, true) : null;

  return (
    <section class="card card-body stack-sm" aria-label={t`Profile picture`}>
      <div class="row-gap">
        <Avatar name={props.name} src={current} size={72} />
        <div style={{ flex: 1 }}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Profile picture</Trans>
          </h2>
          <p class="small muted" style={{ margin: 0 }}>
            {current ? t`Visible to everyone signed in to the app.` : t`No picture yet. Until then, the initial is shown here.`}
          </p>
        </div>
      </div>

      {pendingSrc && props.view === "guardian" ? (
        <div class="notice">
          <Avatar name={props.name} src={pendingSrc} size={56} />
          <div class="stack-sm" style={{ flex: 1 }}>
            <span>
              <Trans>{firstName} would like to use this picture. Others only see it after you approve it.</Trans>
            </span>
            <div class="btn-row">
              <Button
                size="sm"
                variant="primary"
                icon="check"
                onClick={async () => {
                  await api.post(`/persons/${props.personId}/avatar/approve`);
                  toast(t`Approved.`);
                  await changed();
                }}
              >
                <Trans>Approve</Trans>
              </Button>
              <Button
                size="sm"
                icon="x"
                onClick={async () => {
                  await api.del(`/persons/${props.personId}/avatar?pending=1`);
                  toast(t`Rejected.`);
                  await changed();
                }}
              >
                <Trans>Reject</Trans>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingSrc && props.view === "self" ? (
        <div class="notice">
          <Avatar name={props.name} src={pendingSrc} size={56} />
          <div>
            <Trans>Your new picture is waiting for your parents' approval.</Trans>
          </div>
        </div>
      ) : null}

      {info.canUpload ? (
        <>
          {props.view === "self" && info.needsConsent ? (
            <p class="small muted">
              <Trans>Because you are not of age yet, your parents approve your picture before others see it.</Trans>
            </p>
          ) : null}
          {props.view === "guardian" ? (
            <p class="small muted">
              <Trans>A picture you upload applies immediately. Talk it over with {firstName} first.</Trans>
            </p>
          ) : null}
          <div class="btn-row">
            <Button icon="camera" onClick={() => cameraRef.current?.click()}>
              <Trans>Take photo</Trans>
            </Button>
            <Button icon="image" onClick={() => pickRef.current?.click()}>
              <Trans>Choose picture</Trans>
            </Button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
          <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
        </>
      ) : (
        <Notice>
          {props.view === "self"
            ? t`For a profile picture you need your parents' consent. But no parent is linked to your access yet. Ask your coach whether your parents can be added.`
            : t`The profile picture cannot be changed here right now.`}
        </Notice>
      )}

      {current ? (
        <Button
          variant="ghost"
          icon="trash"
          onClick={async () => {
            if (!(await confirmDialog({ title: t`Remove profile picture?`, message: t`After that the initial is shown again.`, confirmLabel: t`Remove`, danger: true }))) return;
            await api.del(`/persons/${props.personId}/avatar`);
            toast(t`Profile picture removed.`);
            await changed();
          }}
        >
          <Trans>Remove picture</Trans>
        </Button>
      ) : null}

      {file ? <CropSheet file={file} onClose={() => setFile(null)} onSave={save} /> : null}
    </section>
  );
}

/** For admins: view and remove a person's existing picture. */
export function AdminAvatar(props: { personId: number; name: string }) {
  const avatars = useAvatars();
  const version = avatars[props.personId];
  if (!version) return null;
  return (
    <section class="stack-sm">
      <strong>
        <Trans>Profile picture</Trans>
      </strong>
      <div class="row-gap">
        <Avatar name={props.name} src={avatarUrl(props.personId, version)} size={56} />
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            const name = props.name;
            if (!(await confirmDialog({ title: t`Remove profile picture?`, message: t`The picture of ${name} will be deleted.`, confirmLabel: t`Remove`, danger: true }))) return;
            await api.del(`/persons/${props.personId}/avatar`);
            refreshAvatars(props.personId);
            toast(t`Profile picture removed.`);
          }}
        >
          <Trans>Remove</Trans>
        </Button>
      </div>
    </section>
  );
}
