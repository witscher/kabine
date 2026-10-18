import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
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
        <Trans>
          <strong>Install as an app:</strong> In Safari, tap <em>Share</em> at the bottom, then <em>Add to Home Screen</em>. Only then do notifications work on
          the iPhone.
        </Trans>
      </Notice>
    );
  }
  const club = clubName();
  return (
    <Notice icon="phone">
      <Trans>
        <strong>Tip:</strong> In the browser menu, choose <em>Add to Home screen</em> or <em>Install app</em>. Then {club} starts like an app.
      </Trans>
    </Notice>
  );
}

export function LoginPage() {
  useDocumentTitle(t`Sign in`);
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
        <h1>
          <Trans>Welcome</Trans>
        </h1>
        <p style={{ color: "var(--on-dark-2)", fontSize: "17px" }}>
          <Trans>Events, responses and the team chat in one place.</Trans>
        </p>
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
            <Trans>Sign in with passkey</Trans>
          </Button>
        ) : (
          <Notice kind="warn">
            <Trans>This browser does not support passkeys. Please use a current smartphone with Safari or Chrome.</Trans>
          </Notice>
        )}
        {error ? (
          <div class="notice warn" role="alert">
            <Icon name="alert" />
            <div>
              {error} <Trans>If you have no access yet or have changed your device, your coach will give you a new invitation link.</Trans>
              {detail ? <div class="small muted" style={{ marginTop: "6px" }}>{detail}</div> : null}
            </div>
          </div>
        ) : null}
        <p class="muted">
          <Trans>
            The passkey is the <strong style={{ color: "var(--text)" }}>safest way to sign in</strong>: Face ID, fingerprint or your screen lock, without a
            password.
          </Trans>
        </p>
        <section class="card card-pad stack-sm" aria-label={t`Sign in by e-mail`}>
          {!emailMode ? (
            <>
              <strong>
                <Trans>No passkey on this device?</Trans>
              </strong>
              <p class="small muted">
                <Trans>We send a code to the e-mail address you gave for your access.</Trans>
              </p>
              <Button icon="mail" onClick={() => setEmailMode(true)}>
                <Trans>Code by e-mail</Trans>
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
              {/* Same for everyone: does not reveal whether the address is known */}
              <Notice icon="info">
                <ClubAppNotice />
              </Notice>
            </>
          ) : (
            <>
              <TextField label={t`E-mail address`} type="email" value={email} onInput={setEmail} autoComplete="email" inputMode="email" maxLength={254} />
              {emailError ? <p class="small" role="alert">{emailError}</p> : null}
              <Button variant="primary" block disabled={!isEmail(email)} onClick={sendCode}>
                <Trans>Send code</Trans>
              </Button>
            </>
          )}
        </section>
        <p class="muted">
          <Trans>
            <strong style={{ color: "var(--text)" }}>No access yet?</strong> Your coach sends you an invitation link, for example in the team's WhatsApp group.
          </Trans>
        </p>
        <InstallHint />
        <div class="spacer" />
        <p class="footer-links">
          <a href="/datenschutz">
            <Trans>Privacy and sources</Trans>
          </a>
        </p>
      </main>
    </div>
  );
}

function ClubAppNotice() {
  const club = clubName();
  return (
    <Trans>
      {club} is an internal club app. If no code arrives, this address is not on file. Access is only available through an invitation from your coach.
    </Trans>
  );
}
