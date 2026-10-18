import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { useClub } from "../club";
import { FaqList } from "../faq";
import { InstallSteps, PushSteps } from "../howto";
import { Icon } from "../icons";
import { useMe } from "../session";
import { Button, Field, Notice, SwitchRow, toast, TopBar, useDocumentTitle } from "../ui";

const MAX_SIDE = 1600;

/** Bild verkleinern (längste Seite 1600 px) und als JPEG verschicken, damit die Mail klein bleibt. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("Dieses Bildformat kann dein Browser nicht öffnen. Bitte ein Foto oder einen Screenshot als JPEG oder PNG wählen.");
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Das Bild konnte nicht umgewandelt werden.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Hilfe und Feedback: Rückmeldung zur App, optional mit Bild, geht per E-Mail an den Betreuer der App. */
export function HelpPage() {
  useDocumentTitle("Hilfe und Feedback");
  const me = useMe();
  const club = useClub();
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reply, setReply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError(null);
    try {
      setImage(await shrink(file));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const send = async () => {
    setError(null);
    const form = new FormData();
    form.set("message", message.trim());
    if (reply) form.set("reply", "1");
    if (image) form.set("image", image, "bild.jpg");
    try {
      const res = await api.form<{ ok: true; replyTo: boolean }>("/feedback", form);
      setMessage("");
      setImage(null);
      setReply(false);
      toast(
        reply && !res.replyTo
          ? "Danke, deine Nachricht ist angekommen. Für eine Antwort per E-Mail fehlt an deinem Zugang eine bestätigte Adresse (Profil)."
          : "Danke, deine Nachricht ist angekommen.",
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <main class="page">
      <TopBar title="Hilfe und Feedback" kicker="Hilfe" back={me.isAdmin ? "/verwaltung" : me.manageableTeams.length ? "/profil" : undefined} />
      <div class="content">
        <FaqList />
        <section class="stack-sm" aria-label="Anleitungen">
          <h2 class="section-title">Anleitungen</h2>
          <details class="card howto-fold">
            <summary>
              <Icon name="phone" size={20} />
              <span>App installieren</span>
              <Icon name="chevron" size={18} />
            </summary>
            <div class="card-body">
              <InstallSteps />
            </div>
          </details>
          <details class="card howto-fold">
            <summary>
              <Icon name="bell" size={20} />
              <span>Benachrichtigungen einrichten</span>
              <Icon name="chevron" size={18} />
            </summary>
            <div class="card-body">
              <PushSteps />
            </div>
          </details>
        </section>
        <h2 class="section-title">Feedback</h2>
        <section class="card card-pad stack">
          <p>
            Etwas funktioniert nicht, ist unklar oder du hast eine Idee? Schreib uns hier deine Rückmeldung zur App. Ein Screenshot hilft oft, ein Problem schnell zu
            verstehen.
          </p>
          <Field label="Deine Nachricht">
            {(id) => (
              <textarea
                id={id}
                class="textarea"
                rows={6}
                value={message}
                maxLength={4000}
                placeholder="Was ist dir aufgefallen?"
                onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
              />
            )}
          </Field>
          {preview ? (
            <div class="feedback-image">
              <img src={preview} alt="Angehängtes Bild" />
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setImage(null)}>
                Bild entfernen
              </Button>
            </div>
          ) : (
            <label class="btn btn-dashed feedback-pick">
              <Icon name="image" size={18} />
              Screenshot oder Bild anhängen (optional)
              <input type="file" accept="image/*" class="sr-only" onChange={pick} />
            </label>
          )}
          <SwitchRow label="Antwort per E-Mail erwünscht" sub="An die bestätigte E-Mail-Adresse deines Zugangs" checked={reply} onChange={setReply} />
          {error ? <Notice kind="warn">{error}</Notice> : null}
          <Button variant="primary" icon="send" block disabled={message.trim().length < 3} onClick={send}>
            Absenden
          </Button>
        </section>
        <p class="small muted credits">
          {club.contact ? (
            <>
              Ansprechpartner für die App: {club.contact}
              <br />
            </>
          ) : null}
          Kabine ist freie Software unter der Lizenz AGPL-3.0. <a href="https://github.com/witscher/kabine">Quellcode</a>
        </p>
      </div>
    </main>
  );
}
