import { ClubMark, clubName } from "../club";
import { useEffect, useState } from "preact/hooks";
import { errorMessage } from "../api";
import { EmailCodeForm, isEmail, startEmailLogin } from "../email";
import { Icon } from "../icons";
import { isIos, isStandalone, loginWithPasskey, passkeyErrorDetail, passkeyErrorMessage, passkeysSupported, prepareLogin, useSession } from "../session";
import { Button, Notice, TextField, useDocumentTitle } from "../ui";

export function InstallHint() {
  if (isStandalone()) return null;
  if (isIos()) {
    return (
      <Notice icon="phone">
        <strong>Als App installieren:</strong> In Safari unten auf <em>Teilen</em> tippen, dann <em>Zum Home-Bildschirm</em>. Nur so funktionieren auf dem iPhone
        auch Benachrichtigungen.
      </Notice>
    );
  }
  return (
    <Notice icon="phone">
      <strong>Tipp:</strong> Über das Browsermenü <em>Zum Startbildschirm hinzufügen</em> bzw. <em>App installieren</em> wählen. Dann startet {clubName()} wie eine
      App.
    </Notice>
  );
}

export function LoginPage() {
  useDocumentTitle("Anmelden");
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const sendCode = async () => {
    setEmailError(null);
    try {
      setRequestId(await startEmailLogin(email));
    } catch (err) {
      setEmailError(errorMessage(err));
    }
  };
  const supported = passkeysSupported();

  // Optionen bereitlegen, damit der Passkey-Dialog direkt aus dem Tippen startet
  useEffect(() => {
    if (!supported) return;
    void prepareLogin();
    const onVisible = () => {
      if (document.visibilityState === "visible") void prepareLogin();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void prepareLogin(), 4 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [supported]);

  return (
    <div class="login-wrap">
      <div class="login-top">
        <ClubMark />
        <div class="kicker">{clubName()}</div>
        <h1>Willkommen</h1>
        <p style={{ color: "var(--on-dark-2)", fontSize: "17px" }}>Termine, Zu- und Absagen und der Mannschaftschat an einem Ort.</p>
      </div>
      <main class="login-card">
        {supported ? (
          <Button
            variant="primary"
            size="lg"
            block
            icon="key"
            onClick={async () => {
              setError(null);
              try {
                await loginWithPasskey();
                await refresh();
              } catch (err) {
                setError(passkeyErrorMessage(err, "login"));
                setDetail(passkeyErrorDetail(err));
              }
            }}
          >
            Mit Passkey anmelden
          </Button>
        ) : (
          <Notice kind="warn">
            Dieser Browser unterstützt keine Passkeys. Bitte nutze ein aktuelles Smartphone mit Safari oder Chrome.
          </Notice>
        )}
        {error ? (
          <div class="notice warn" role="alert">
            <Icon name="alert" />
            <div>
              {error} Falls du noch keinen Zugang hast oder dein Gerät gewechselt hast, bekommst du von deinem Trainer einen neuen Einladungslink.
              {detail ? <div class="small muted" style={{ marginTop: "6px" }}>{detail}</div> : null}
            </div>
          </div>
        ) : null}
        <p class="muted">
          Der Passkey ist die <strong style={{ color: "var(--text)" }}>sicherste Anmeldung</strong>: Face ID, Fingerabdruck oder deine Gerätesperre, ohne
          Passwort.
        </p>
        <section class="card card-pad stack-sm" aria-label="Anmeldung per E-Mail">
          {!emailMode ? (
            <>
              <strong>Kein Passkey auf diesem Gerät?</strong>
              <p class="small muted">Wir schicken dir einen Code an die E-Mail-Adresse, die du bei deinem Zugang angegeben hast.</p>
              <Button icon="mail" onClick={() => setEmailMode(true)}>
                Code per E-Mail
              </Button>
            </>
          ) : requestId ? (
            <>
              <EmailCodeForm
                requestId={requestId}
                email={email.trim()}
                onDone={async () => {
                  await refresh();
                }}
                onResend={sendCode}
              />
              {/* Für alle gleich: verrät nicht, ob die Adresse bekannt ist */}
              <Notice icon="info">
                {clubName()} ist eine interne Vereins-App. Kommt kein Code, ist diese Adresse nicht hinterlegt. Einen Zugang gibt es nur über eine Einladung deiner
                Trainerin oder deines Trainers.
              </Notice>
            </>
          ) : (
            <>
              <TextField label="E-Mail-Adresse" type="email" value={email} onInput={setEmail} autoComplete="email" inputMode="email" maxLength={254} />
              {emailError ? <p class="small" role="alert">{emailError}</p> : null}
              <Button variant="primary" block disabled={!isEmail(email)} onClick={sendCode}>
                Code senden
              </Button>
            </>
          )}
        </section>
        <p class="muted">
          <strong style={{ color: "var(--text)" }}>Noch kein Zugang?</strong> Deine Trainerin oder dein Trainer schickt dir einen Einladungslink, zum Beispiel in
          der WhatsApp-Gruppe der Mannschaft.
        </p>
        <InstallHint />
        <div class="spacer" />
        <p class="footer-links">
          <a href="/datenschutz">Datenschutz und Quellen</a>
        </p>
      </main>
    </div>
  );
}
