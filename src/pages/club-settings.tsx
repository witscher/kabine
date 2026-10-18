// Club profile: name, abbreviation, colours, logo, privacy notice, contact. The form is also a
// step of the setup wizard.
import { useState } from "preact/hooks";
import { type ClubProfile, isHexColor } from "../../shared/club";
import { api, errorMessage } from "../api";
import { ClubMark, loadClub, setClub, useClub } from "../club";
import { Button, Field, Notice, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

const LOGO_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml";

export function ClubProfileForm({ onSaved, submitLabel = "Speichern" }: { onSaved?: () => void; submitLabel?: string }) {
  const club = useClub();
  const [name, setName] = useState(club.name);
  const [shortName, setShortName] = useState(club.shortName);
  const [abbr, setAbbr] = useState(club.abbr);
  const [primary, setPrimary] = useState(club.colors.primary);
  const [accent, setAccent] = useState(club.colors.accent);
  const [privacyUrl, setPrivacyUrl] = useState(club.privacyUrl ?? "");
  const [privacyText, setPrivacyText] = useState(club.privacyText ?? "");
  const [contact, setContact] = useState(club.contact ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!isHexColor(primary) || !isHexColor(accent)) return setError("Bitte wähle zwei Farben.");
    try {
      const saved = await api.put<ClubProfile>("/admin/club", {
        name: name.trim(),
        shortName: shortName.trim(),
        abbr: abbr.trim(),
        colors: { primary, accent },
        privacyUrl: privacyUrl.trim() || null,
        privacyText: privacyText.trim() || null,
        contact: contact.trim() || null,
      });
      setClub(saved);
      toast("Gespeichert");
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      await api.upload("/admin/club/logo", file);
      await loadClub();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div class="stack">
      <section class="card card-pad stack" aria-label="Name">
        <TextField label="Name des Vereins" value={name} onInput={setName} maxLength={80} hint="Zum Beispiel „SV Musterstadt 1900 Handball“" required />
        <TextField label="Kurzname" value={shortName} onInput={setShortName} maxLength={24} hint="Auf dem Startbildschirm und in Benachrichtigungen" required />
        <TextField
          label="Kürzel"
          value={abbr}
          onInput={setAbbr}
          maxLength={8}
          hint="Vor der eigenen Mannschaft in Spieltiteln, z. B. „SVM wD – HSG Gegner“. Leer: Anfangsbuchstaben des Kurznamens."
        />
      </section>
      <section class="card card-pad stack" aria-label="Farben und Logo">
        <div class="club-preview" style={{ "--black": primary, "--yellow": accent }}>
          <ClubMark />
          <strong>{shortName || "Kurzname"}</strong>
        </div>
        <div class="club-colors">
          <Field label="Hauptfarbe">
            {(id) => <input id={id} type="color" class="color-input" value={primary} onInput={(e) => setPrimary((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field label="Akzentfarbe">
            {(id) => <input id={id} type="color" class="color-input" value={accent} onInput={(e) => setAccent((e.target as HTMLInputElement).value)} />}
          </Field>
        </div>
        <p class="small muted">Die Hauptfarbe sollte dunkel sein, die Akzentfarbe hell, damit Schrift auf beiden gut lesbar bleibt.</p>
        <div class="row-gap">
          <label class="btn btn-dashed">
            Logo hochladen
            <input type="file" accept={LOGO_TYPES} class="sr-only" onChange={(e) => void uploadLogo((e.target as HTMLInputElement).files?.[0])} />
          </label>
          {club.logoVersion ? (
            <Button
              variant="ghost"
              icon="trash"
              onClick={async () => {
                await api.del("/admin/club/logo");
                await loadClub();
              }}
            >
              Logo entfernen
            </Button>
          ) : null}
        </div>
        <p class="small muted">PNG, JPEG, WebP oder SVG, höchstens 256 KB. Ohne Logo zeigt die App das Kürzel.</p>
      </section>
      <section class="card card-pad stack" aria-label="Datenschutz und Kontakt">
        <TextField
          label="Link zu Datenschutzerklärung und Impressum"
          type="url"
          inputMode="url"
          value={privacyUrl}
          onInput={setPrivacyUrl}
          placeholder="https://"
          hint="Erscheint unter Datenschutz. Die Hinweise zur App selbst stehen dort schon."
        />
        <Field label="Ergänzende Hinweise zum Datenschutz (optional)">
          {(id) => (
            <textarea id={id} class="textarea" rows={4} maxLength={5000} value={privacyText} onInput={(e) => setPrivacyText((e.target as HTMLTextAreaElement).value)} />
          )}
        </Field>
        <TextField label="Ansprechpartner für die App (optional)" value={contact} onInput={setContact} maxLength={200} hint="Name und E-Mail-Adresse, erscheint unter Hilfe" />
      </section>
      {error ? <Notice kind="warn">{error}</Notice> : null}
      <Button variant="primary" block disabled={!name.trim() || !shortName.trim()} onClick={save}>
        {submitLabel}
      </Button>
    </div>
  );
}

export function AdminClubPage() {
  useDocumentTitle("Verein");
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Verein" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          <ClubProfileForm />
        </div>
      </main>
    </AdminOnly>
  );
}
