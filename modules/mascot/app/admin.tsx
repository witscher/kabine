// Administration → Club mascot: one tile per slot with the picture, upload and remove.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api, errorMessage } from "../../../src/api";
import { loadClub } from "../../../src/club";
import { useMascotImage } from "../../../src/modules";
import { AdminOnly } from "../../../src/pages/admin";
import { Button, confirmDialog, toast, TopBar, useDocumentTitle } from "../../../src/ui";
import type { MascotSlot } from "../../../shared/module-api";
import { FACE_SLOTS } from "../shared/rules";
import { ACCEPT, prepareMascot } from "./prepare";

const slotLabels = (): Record<MascotSlot, string> => ({
  win: t`Win`,
  draw: t`Draw`,
  close: t`Close loss`,
  clear: t`Clear loss`,
  card: t`Home game day card`,
  head: t`Home game day tile`,
});

export function AdminMascotPage() {
  useDocumentTitle(t`Club mascot`);
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Club mascot`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <p class="muted">
            <Trans>
              Pictures of your club's mascot. PNG, WebP or SVG with a transparent or white background, at least 256 pixels; the faces square. The app
              scales them down before the upload. Where a picture is missing, nothing is shown in its place.
            </Trans>
          </p>
          <section class="card card-pad stack-sm" aria-label={t`Faces for results`}>
            <strong>
              <Trans>Faces for results</Trans>
            </strong>
            <p class="small muted">
              <Trans>Next to the result of a game, for players under 14: won, drawn, lost narrowly (up to 4 goals) or clearly.</Trans>
            </p>
            <div class="mascot-slots">
              {FACE_SLOTS.map((s) => (
                <SlotTile key={s} slot={s} />
              ))}
            </div>
          </section>
          <section class="card card-pad stack-sm" aria-label={t`Home game day`}>
            <strong>
              <Trans>Home game day</Trans>
            </strong>
            <p class="small muted">
              <Trans>With the home game day module: the picture on the large card on the start page and the head on the small tiles of later days.</Trans>
            </p>
            <div class="mascot-slots">
              <SlotTile slot="card" />
              <SlotTile slot="head" />
            </div>
          </section>
        </div>
      </main>
    </AdminOnly>
  );
}

function SlotTile({ slot }: { slot: MascotSlot }) {
  const url = useMascotImage(slot);
  const [busy, setBusy] = useState(false);
  const label = slotLabels()[slot];
  const upload = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/mascot/images/${slot}`, await prepareMascot(file, slot));
      await loadClub();
      toast(t`Picture saved.`);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: t`Remove picture?`, message: t`Nothing is shown in its place then.`, confirmLabel: t`Remove`, danger: true }))) return;
    try {
      await api.del(`/mascot/images/${slot}`);
      await loadClub();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  return (
    <div class="mascot-slot" data-slot={slot}>
      <div class="mascot-preview">{url ? <img src={url} alt={label} decoding="async" /> : <span class="small muted">{t`No picture`}</span>}</div>
      <strong class="small">{label}</strong>
      <label class={`btn btn-sm btn-dashed ${busy ? "disabled" : ""}`}>
        {url ? <Trans>Replace</Trans> : <Trans>Upload</Trans>}
        <input type="file" accept={ACCEPT} class="sr-only" disabled={busy} aria-label={t`Upload picture: ${label}`} onChange={(e) => void upload(e.target as HTMLInputElement)} />
      </label>
      {url ? (
        <Button variant="ghost" size="sm" icon="trash" onClick={() => void remove()} aria-label={t`Remove picture: ${label}`}>
          <Trans>Remove</Trans>
        </Button>
      ) : null}
    </div>
  );
}
