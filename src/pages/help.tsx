import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { useClub } from "../club";
import { FaqList } from "../faq";
import { InstallSteps, PushSteps } from "../howto";
import { Icon } from "../icons";
import { useMe } from "../session";
import { Button, Field, Notice, SwitchRow, toast, TopBar, useDocumentTitle } from "../ui";

const MAX_SIDE = 1600;

/** Shrink the image (longest side 1600 px) and send it as JPEG, so the mail stays small. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error(t`Your browser cannot open this image format. Please choose a photo or screenshot as JPEG or PNG.`);
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
    if (!blob) throw new Error(t`The image could not be converted.`);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Help and feedback: feedback on the app, optionally with an image, goes by e-mail to the app's maintainer. */
export function HelpPage() {
  useDocumentTitle(t`Help and feedback`);
  const me = useMe();
  const club = useClub();
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reply, setReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contact = club.contact;

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
          ? t`Thank you, your message has arrived. For a reply by e-mail, your access lacks a confirmed address (profile).`
          : t`Thank you, your message has arrived.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <main class="page">
      <TopBar title={t`Help and feedback`} kicker={t`Help`} back={me.isAdmin ? "/verwaltung" : me.manageableTeams.length ? "/profil" : undefined} />
      <div class="content">
        <FaqList />
        <section class="stack-sm" aria-label={t`Guides`}>
          <h2 class="section-title">
            <Trans>Guides</Trans>
          </h2>
          <details class="card howto-fold">
            <summary>
              <Icon name="phone" size={20} />
              <span>
                <Trans>Install app</Trans>
              </span>
              <Icon name="chevron" size={18} />
            </summary>
            <div class="card-body">
              <InstallSteps />
            </div>
          </details>
          <details class="card howto-fold">
            <summary>
              <Icon name="bell" size={20} />
              <span>
                <Trans>Set up notifications</Trans>
              </span>
              <Icon name="chevron" size={18} />
            </summary>
            <div class="card-body">
              <PushSteps />
            </div>
          </details>
        </section>
        <h2 class="section-title">
          <Trans>Feedback</Trans>
        </h2>
        <section class="card card-pad stack">
          <p>
            <Trans>
              Something does not work, is unclear or you have an idea? Write your feedback on the app to us here. A screenshot often helps to understand a problem
              quickly.
            </Trans>
          </p>
          <Field label={t`Your message`}>
            {(id) => (
              <textarea
                id={id}
                class="textarea"
                rows={6}
                value={message}
                maxLength={4000}
                placeholder={t`What did you notice?`}
                onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
              />
            )}
          </Field>
          {preview ? (
            <div class="feedback-image">
              <img src={preview} alt={t`Attached image`} />
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setImage(null)}>
                <Trans>Remove image</Trans>
              </Button>
            </div>
          ) : (
            <label class="btn btn-dashed feedback-pick">
              <Icon name="image" size={18} />
              <Trans>Attach screenshot or image (optional)</Trans>
              <input type="file" accept="image/*" class="sr-only" onChange={pick} />
            </label>
          )}
          <SwitchRow label={t`Reply by e-mail wanted`} sub={t`To the confirmed e-mail address of your access`} checked={reply} onChange={setReply} />
          {error ? <Notice kind="warn">{error}</Notice> : null}
          <Button variant="primary" icon="send" block disabled={message.trim().length < 3} onClick={send}>
            <Trans context="feedback">Send</Trans>
          </Button>
        </section>
        <p class="small muted credits">
          {contact ? (
            <>
              <Trans>Contact for the app: {contact}</Trans>
              <br />
            </>
          ) : null}
          <Trans>
            Kabine is free software under the AGPL-3.0 licence. <a href="https://github.com/witscher/kabine">Source code</a>
          </Trans>
        </p>
      </div>
    </main>
  );
}
