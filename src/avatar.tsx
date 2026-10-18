// Profilbilder: Anzeige, Aufnahme mit der Kamera oder Auswahl, Zuschneiden, Freigabe.
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { invalidate, useQuery } from "./store";
import { Avatar, Button, confirmDialog, Notice, Sheet, Spinner, toast } from "./ui";

/** Kantenlänge des gespeicherten Bildes in Pixeln. */
const OUTPUT = 256;
/** Größe des Zuschneide-Feldes auf dem Bildschirm. */
const VIEW = 280;
const MAX_ZOOM = 4;

export function avatarUrl(personId: number, version: number, pending = false): string {
  return `/api/persons/${personId}/avatar?${pending ? "pending=1&" : ""}v=${version}`;
}

/** Alle freigegebenen Bilder (personId → Version), einmal geladen und geteilt. */
export function useAvatars(): Record<string, number> {
  return useQuery<{ avatars: Record<string, number> }>("/avatars").data?.avatars ?? {};
}

/** Avatar einer Person: Bild, falls freigegeben, sonst der Anfangsbuchstabe. */
export function PersonAvatar(props: { personId: number | null; name: string; coach?: boolean; size?: number }) {
  const avatars = useAvatars();
  const version = props.personId ? avatars[props.personId] : undefined;
  return <Avatar name={props.name} coach={props.coach} size={props.size} src={version && props.personId ? avatarUrl(props.personId, version) : null} />;
}

function refreshAvatars(personId: number) {
  invalidate("/avatars", `/persons/${personId}/avatar`);
}

// Zuschneiden ---------------------------------------------------------------------

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
      reject(new Error("Das Bild konnte nicht geöffnet werden. Bitte ein Foto im Format JPEG, PNG, WebP oder HEIC wählen."));
    };
    img.src = url;
  });
}

/** Maßstab, bei dem das Bild das quadratische Feld gerade ausfüllt. */
function coverScale(img: HTMLImageElement): number {
  return VIEW / Math.min(img.naturalWidth, img.naturalHeight);
}

/** Verschiebung so begrenzen, dass immer das ganze Feld bedeckt ist. */
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

/** Als WebP speichern, wo der Browser das kann (Safari kann es nicht), sonst als JPEG. */
async function exportImage(img: HTMLImageElement, crop: Crop): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  draw(canvas.getContext("2d")!, img, crop, OUTPUT);
  const webp = await toBlob(canvas, "image/webp", 0.85);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error("Das Bild konnte nicht umgewandelt werden.");
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
    // Das Feld wird per CSS eventuell kleiner dargestellt als VIEW
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const k = VIEW / rect.width;
    update({ ...crop, x: crop.x + (e.clientX - last.x) * k, y: crop.y + (e.clientY - last.y) * k });
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return (
    <Sheet open onClose={props.onClose} title="Bild zuschneiden">
      {error ? <Notice kind="warn">{error}</Notice> : null}
      {!img && !error ? <Spinner label="Bild wird geladen" /> : null}
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
            <canvas ref={canvasRef} aria-label="Vorschau des Profilbilds" />
            <div class="crop-mask" aria-hidden="true" />
          </div>
          <label class="crop-zoom">
            <span class="small muted">Zoom</span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onInput={(e) => update({ ...crop, zoom: Number((e.target as HTMLInputElement).value) })}
            />
          </label>
          <p class="small muted">Verschieben mit dem Finger, vergrößern mit zwei Fingern oder dem Regler.</p>
          <Button variant="primary" size="lg" block icon="check" onClick={async () => props.onSave(await exportImage(img, crop))}>
            Übernehmen
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

// Bearbeiten ----------------------------------------------------------------------

interface AvatarInfo {
  approved: number | null;
  pending: number | null;
  needsConsent: boolean;
  hasGuardians: boolean;
  canUpload: boolean;
  canApprove: boolean;
}

/**
 * Profilbild der eigenen Person oder eines Kindes. "self" ist die Sicht der
 * Person, "guardian" die eines Elternteils.
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
    toast(res.status === "pending" ? "Gespeichert. Deine Eltern müssen das Bild noch freigeben." : "Profilbild gespeichert.");
    await changed();
  };

  if (!info) return <Spinner />;

  const current = info.approved != null ? avatarUrl(props.personId, info.approved) : null;
  const pendingSrc = info.pending != null ? avatarUrl(props.personId, info.pending, true) : null;

  return (
    <section class="card card-body stack-sm" aria-label="Profilbild">
      <div class="row-gap">
        <Avatar name={props.name} src={current} size={72} />
        <div style={{ flex: 1 }}>
          <h2 class="section-title" style={{ margin: 0 }}>
            Profilbild
          </h2>
          <p class="small muted" style={{ margin: 0 }}>
            {current ? "Sichtbar für alle, die in der App angemeldet sind." : "Noch kein Bild. Bis dahin steht hier der Anfangsbuchstabe."}
          </p>
        </div>
      </div>

      {pendingSrc && props.view === "guardian" ? (
        <div class="notice">
          <Avatar name={props.name} src={pendingSrc} size={56} />
          <div class="stack-sm" style={{ flex: 1 }}>
            <span>
              {firstName} möchte dieses Bild verwenden. Erst nach deiner Freigabe sehen es andere.
            </span>
            <div class="btn-row">
              <Button
                size="sm"
                variant="primary"
                icon="check"
                onClick={async () => {
                  await api.post(`/persons/${props.personId}/avatar/approve`);
                  toast("Freigegeben.");
                  await changed();
                }}
              >
                Freigeben
              </Button>
              <Button
                size="sm"
                icon="x"
                onClick={async () => {
                  await api.del(`/persons/${props.personId}/avatar?pending=1`);
                  toast("Abgelehnt.");
                  await changed();
                }}
              >
                Ablehnen
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingSrc && props.view === "self" ? (
        <div class="notice">
          <Avatar name={props.name} src={pendingSrc} size={56} />
          <div>Dein neues Bild wartet auf die Freigabe durch deine Eltern.</div>
        </div>
      ) : null}

      {info.canUpload ? (
        <>
          {props.view === "self" && info.needsConsent ? (
            <p class="small muted">Weil du noch nicht volljährig bist, geben deine Eltern dein Bild frei, bevor andere es sehen.</p>
          ) : null}
          {props.view === "guardian" ? <p class="small muted">Ein Bild, das du hochlädst, gilt sofort. Sprich es vorher mit {firstName} ab.</p> : null}
          <div class="btn-row">
            <Button icon="camera" onClick={() => cameraRef.current?.click()}>
              Foto machen
            </Button>
            <Button icon="image" onClick={() => pickRef.current?.click()}>
              Bild wählen
            </Button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
          <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
        </>
      ) : (
        <Notice>
          {props.view === "self"
            ? "Für ein Profilbild brauchst du die Zustimmung deiner Eltern. Mit deinem Zugang ist aber noch kein Elternteil verknüpft. Frag deinen Trainer, ob deine Eltern eingebunden werden können."
            : "Ein Profilbild kann hier gerade nicht geändert werden."}
        </Notice>
      )}

      {current ? (
        <Button
          variant="ghost"
          icon="trash"
          onClick={async () => {
            if (!(await confirmDialog({ title: "Profilbild entfernen?", message: "Danach steht wieder der Anfangsbuchstabe da.", confirmLabel: "Entfernen", danger: true }))) return;
            await api.del(`/persons/${props.personId}/avatar`);
            toast("Profilbild entfernt.");
            await changed();
          }}
        >
          Bild entfernen
        </Button>
      ) : null}

      {file ? <CropSheet file={file} onClose={() => setFile(null)} onSave={save} /> : null}
    </section>
  );
}

/** Für Admins: vorhandenes Bild einer Person ansehen und entfernen. */
export function AdminAvatar(props: { personId: number; name: string }) {
  const avatars = useAvatars();
  const version = avatars[props.personId];
  if (!version) return null;
  return (
    <section class="stack-sm">
      <strong>Profilbild</strong>
      <div class="row-gap">
        <Avatar name={props.name} src={avatarUrl(props.personId, version)} size={56} />
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            if (!(await confirmDialog({ title: "Profilbild entfernen?", message: `Das Bild von ${props.name} wird gelöscht.`, confirmLabel: "Entfernen", danger: true }))) return;
            await api.del(`/persons/${props.personId}/avatar`);
            refreshAvatars(props.personId);
            toast("Profilbild entfernt.");
          }}
        >
          Entfernen
        </Button>
      </div>
    </section>
  );
}
