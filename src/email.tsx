// Sign-in and confirmation by e-mail code or link.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName } from "./club";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "./api";
import { Icon } from "./icons";
import { useSession } from "./session";
import { clearCache } from "./store";
import { Button, Notice, Spinner, TextField, TopBar, useDocumentTitle } from "./ui";

export type EmailKind = "login" | "join" | "verify";

interface Choice {
  accountId: number;
  firstName: string;
  lastName: string | null;
}

type VerifyResponse = { ok: true; kind: EmailKind } | { choose: Choice[] };

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** Request a sign-in code. The response deliberately does not say whether the address is known. */
export async function startEmailLogin(email: string): Promise<string> {
  return (await api.post<{ requestId: string }>("/auth/email/start", { email: email.trim() })).requestId;
}

function ChooseAccount(props: { choices: Choice[]; onPick: (accountId: number) => Promise<void> }) {
  return (
    <div class="stack-sm">
      <p>
        <Trans>Several accesses belong to this address. Which one do you want to sign in with?</Trans>
      </p>
      {props.choices.map((c) => (
        <Button block size="lg" onClick={() => props.onPick(c.accountId)}>
          {c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName}
        </Button>
      ))}
    </div>
  );
}

/** Code entry after sending. onDone receives what happened. */
export function EmailCodeForm(props: {
  requestId: string;
  email: string;
  onDone: (kind: EmailKind) => Promise<void> | void;
  onResend?: () => Promise<void>;
  /** sms: the code went by text message to the phone number in `email` */
  channel?: "email" | "sms";
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);

  const submit = async (accountId?: number) => {
    setError(null);
    try {
      const res = await api.post<VerifyResponse>("/auth/email/verify", { requestId: props.requestId, code: code.replace(/\s/g, ""), accountId });
      if ("choose" in res) {
        setChoices(res.choose);
        return;
      }
      await props.onDone(res.kind);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (choices) return <ChooseAccount choices={choices} onPick={(id) => submit(id)} />;

  const email = props.email;

  return (
    <div class="stack-sm">
      {props.channel === "sms" ? (
        <p>
          <Trans>
            We have sent a six-digit code by text message to <strong>{email}</strong> if an access belongs to this number. It is valid for 15 minutes.
          </Trans>
        </p>
      ) : (
        <p>
          <Trans>
            We have sent a six-digit code to <strong>{email}</strong> if an access belongs to this address. It is valid for 15 minutes. Please also check your
            spam folder.
          </Trans>
        </p>
      )}
      <TextField label={props.channel === "sms" ? t`Code from the text message` : t`Code from the e-mail`} value={code} onInput={(v) => setCode(v.replace(/[^\d ]/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
      {error ? (
        <div class="notice warn" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      ) : null}
      <Button variant="primary" size="lg" block disabled={code.replace(/\s/g, "").length !== 6} onClick={() => submit()}>
        <Trans>Confirm</Trans>
      </Button>
      {props.onResend ? (
        <Button variant="ghost" onClick={props.onResend}>
          <Trans>Send a new code</Trans>
        </Button>
      ) : null}
    </div>
  );
}

/** Target of the link in the e-mail (/email#token). */
export function EmailLinkPage() {
  useDocumentTitle(t`E-mail`);
  const { refresh } = useSession();
  const [token] = useState(() => window.location.hash.replace(/^#/, ""));
  const [state, setState] = useState<{ kind: EmailKind } | { choose: Choice[] } | { error: string } | null>(null);

  const verify = async (accountId?: number) => {
    try {
      const res = await api.post<VerifyResponse>("/auth/email/verify", { token, accountId });
      if ("choose" in res) {
        setState({ choose: res.choose });
        return;
      }
      if (res.kind !== "verify") {
        clearCache();
        await refresh();
      }
      setState({ kind: res.kind });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  };

  useEffect(() => {
    // Remove the link from the address bar so it does not stay in the history
    history.replaceState(null, "", "/email");
    if (token) void verify();
    else setState({ error: t`The link is incomplete. Please open it again in full or enter the code.` });
  }, []);

  return (
    <main class="page no-tabs">
      <TopBar title={t`E-mail`} kicker={clubName()} />
      <div class="content">
        {!state ? <Spinner label={t`Checking link`} /> : null}
        {state && "choose" in state ? <ChooseAccount choices={state.choose} onPick={(id) => verify(id)} /> : null}
        {state && "error" in state ? (
          <>
            <Notice kind="warn">{state.error}</Notice>
            <a class="btn" href="/">
              <Trans>Go to sign-in</Trans>
            </a>
          </>
        ) : null}
        {state && "kind" in state ? (
          <>
            <Notice>
              {state.kind === "verify" ? t`Your e-mail address is confirmed. You can now also sign in with an e-mail code.` : t`You are signed in.`}
            </Notice>
            <Notice icon="phone">
              <Trans>
                Do you use the app from the Home Screen? Then you are not signed in there automatically. Request a code there and enter it directly in the app.
              </Trans>
            </Notice>
            <a class="btn btn-primary" href="/">
              {state.kind === "verify" ? t`Go to the app` : t`Go to events`}
            </a>
          </>
        ) : null}
      </div>
    </main>
  );
}
