// Anmeldung und Bestätigung per E-Mail-Code oder Link.
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

/** Anmelde-Code anfordern. Die Antwort sagt bewusst nicht, ob die Adresse bekannt ist. */
export async function startEmailLogin(email: string): Promise<string> {
  return (await api.post<{ requestId: string }>("/auth/email/start", { email: email.trim() })).requestId;
}

function ChooseAccount(props: { choices: Choice[]; onPick: (accountId: number) => Promise<void> }) {
  return (
    <div class="stack-sm">
      <p>Zu dieser Adresse gehören mehrere Zugänge. Mit welchem möchtest du dich anmelden?</p>
      {props.choices.map((c) => (
        <Button block size="lg" onClick={() => props.onPick(c.accountId)}>
          {c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName}
        </Button>
      ))}
    </div>
  );
}

/** Code-Eingabe nach dem Versand. onDone bekommt, was passiert ist. */
export function EmailCodeForm(props: { requestId: string; email: string; onDone: (kind: EmailKind) => Promise<void> | void; onResend?: () => Promise<void> }) {
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

  return (
    <div class="stack-sm">
      <p>
        Wir haben einen sechsstelligen Code an <strong>{props.email}</strong> geschickt, falls zu der Adresse ein Zugang gehört. Er gilt 15 Minuten. Schau
        auch im Spam-Ordner nach.
      </p>
      <TextField label="Code aus der E-Mail" value={code} onInput={(v) => setCode(v.replace(/[^\d ]/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
      {error ? (
        <div class="notice warn" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      ) : null}
      <Button variant="primary" size="lg" block disabled={code.replace(/\s/g, "").length !== 6} onClick={() => submit()}>
        Bestätigen
      </Button>
      {props.onResend ? (
        <Button variant="ghost" onClick={props.onResend}>
          Neuen Code senden
        </Button>
      ) : null}
    </div>
  );
}

/** Ziel des Links aus der E-Mail (/email#token). */
export function EmailLinkPage() {
  useDocumentTitle("E-Mail");
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
    // Den Link aus der Adresszeile entfernen, damit er nicht im Verlauf bleibt
    history.replaceState(null, "", "/email");
    if (token) void verify();
    else setState({ error: "Der Link ist unvollständig. Bitte öffne ihn noch einmal vollständig oder gib den Code ein." });
  }, []);

  return (
    <main class="page no-tabs">
      <TopBar title="E-Mail" kicker={clubName()} />
      <div class="content">
        {!state ? <Spinner label="Link wird geprüft" /> : null}
        {state && "choose" in state ? <ChooseAccount choices={state.choose} onPick={(id) => verify(id)} /> : null}
        {state && "error" in state ? (
          <>
            <Notice kind="warn">{state.error}</Notice>
            <a class="btn" href="/">
              Zur Anmeldung
            </a>
          </>
        ) : null}
        {state && "kind" in state ? (
          <>
            <Notice>
              {state.kind === "verify" ? "Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt auch per E-Mail-Code anmelden." : "Du bist angemeldet."}
            </Notice>
            <Notice icon="phone">
              Nutzt du die App vom Home-Bildschirm? Dann bist du dort nicht automatisch angemeldet. Fordere dort einen Code an und gib ihn direkt in der App ein.
            </Notice>
            <a class="btn btn-primary" href="/">
              {state.kind === "verify" ? "Zur App" : "Zu den Terminen"}
            </a>
          </>
        ) : null}
      </div>
    </main>
  );
}
