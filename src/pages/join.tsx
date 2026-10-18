import { clubName } from "../club";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { EmailCodeForm, isEmail, startEmailLogin } from "../email";
import { fullDate, isoToLocalDate } from "../format";
import { Icon } from "../icons";
import { isIosOtherBrowser, loginWithPasskey, passkeyErrorMessage, passkeysSupported, prepareLogin, prepareRegistration, registerPasskey, useSession } from "../session";
import { clearCache } from "../store";
import { Button, ErrorBox, Notice, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { InstallHint } from "./login";

type JoinInfo =
  | {
      kind: "player" | "parent";
      team: { id: number; name: string };
      expiresAt: string;
      loggedInAs: string | null;
      persons: { id: number; name: string; taken: boolean; linkedToMe: boolean }[];
    }
  | {
      kind: "personal";
      expiresAt: string;
      loggedInAs: string | null;
      person: { name: string; hasAccount: boolean; isAdmin: boolean };
      revokeExisting: boolean;
    };

function tokenFromHash(): string {
  return decodeURIComponent(location.hash.replace(/^#/, "")).trim();
}

function Done(props: { title: string; text: string }) {
  const { route } = useLocation();
  return (
    <main class="page no-tabs">
      <TopBar title={props.title} kicker={clubName()} />
      <div class="content">
        <div class="card card-pad stack">
          <div class="row-gap">
            <span class="logo-mark" style={{ width: "44px", height: "44px", fontSize: "18px" }} aria-hidden="true">
              <Icon name="check" size={26} stroke={3} />
            </span>
            <h2 style={{ fontSize: "26px" }}>Geschafft!</h2>
          </div>
          <p>{props.text}</p>
        </div>
        <InstallHint />
        <Button variant="primary" size="lg" block onClick={() => route("/", true)}>
          Zur App
        </Button>
      </div>
    </main>
  );
}

function PersonChoice(props: { name: string; selected: boolean; disabled?: boolean; note?: string; multi?: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        class="list-row"
        role={props.multi ? "checkbox" : "radio"}
        aria-checked={props.selected ? "true" : "false"}
        disabled={props.disabled}
        onClick={props.onSelect}
        style={props.disabled ? { color: "var(--text-2)", background: "var(--bg)" } : undefined}
      >
        {props.multi ? (
          <span class={`check ${props.selected ? "on" : ""} ${props.disabled ? "disabled" : ""}`}>{props.selected ? <Icon name="check" size={16} stroke={3} /> : null}</span>
        ) : (
          <span class={`radio ${props.selected ? "on" : ""}`} style={props.disabled ? { borderStyle: "dashed", borderColor: "var(--grey)" } : undefined} />
        )}
        <span class="main">
          <span class="title">{props.name}</span>
          {props.note ? <span class="sub">{props.note}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function JoinPage() {
  useDocumentTitle("Einladung");
  const { refresh, me } = useSession();
  const [token] = useState(tokenFromHash);
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setInfo(await api.post<JoinInfo>("/join/info", { token }));
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    if (!token) setError(new Error("Der Link ist unvollständig. Bitte öffne den Einladungslink noch einmal vollständig."));
    else void load();
  }, [token]);

  /** Neuer Zugang? Dann gibt es das Feld für die E-Mail-Adresse, Pflicht ist sie nur für Admins. */
  const needsEmail = !!info && (info.kind === "player" || (info.kind === "parent" && !me) || (info.kind === "personal" && !info.person.hasAccount));
  const emailRequired = !!info && info.kind === "personal" && !info.person.hasAccount && info.person.isAdmin;

  /** Anfrage für Passkey und E-Mail-Code, oder null, solange etwas fehlt. */
  const joinBody = (): Record<string, unknown> | null => {
    if (!info) return null;
    const trimmed = email.trim();
    if (needsEmail && trimmed && !isEmail(trimmed)) return null;
    if (emailRequired && !trimmed) return null;
    const mail = needsEmail && trimmed ? { email: trimmed.toLowerCase() } : {};
    if (info.kind === "personal") return { token, ...mail };
    if (!selected.length) return null;
    if (info.kind === "parent") {
      if (!firstName.trim() || !lastName.trim()) return null;
      return { token, firstName: firstName.trim(), lastName: lastName.trim(), childIds: selected, ...mail };
    }
    return { token, personId: selected[0], ...mail };
  };

  // Passkey-Optionen bereitlegen, sobald feststeht, wofür (iOS, siehe session.tsx)
  useEffect(() => {
    if (info?.kind === "parent" && me) return;
    if (info?.kind === "parent") void prepareLogin();
    const body = joinBody();
    if (!body) return;
    const timer = window.setTimeout(() => void prepareRegistration("/join", body), 400);
    return () => window.clearTimeout(timer);
  }, [info, me, selected, email, firstName, lastName]);

  if (done) return <Done title="Willkommen" text={done} />;

  if (error) {
    return (
      <main class="page no-tabs">
        <TopBar title="Einladung" kicker={clubName()} />
        <div class="content">
          <ErrorBox error={error} />
          <a class="btn" href="/">
            Zur Anmeldung
          </a>
        </div>
      </main>
    );
  }
  if (!info) return <Spinner label="Einladung wird geprüft" />;

  const finish = async (text: string) => {
    clearCache();
    await refresh();
    setDone(text);
  };

  if (!passkeysSupported()) {
    return (
      <main class="page no-tabs">
        <TopBar title="Einladung" kicker={clubName()} />
        <div class="content">
          <Notice kind="warn">Dieser Browser unterstützt keine Passkeys. Bitte öffne den Link in Safari (iPhone) oder Chrome (Android).</Notice>
        </div>
      </main>
    );
  }

  if (info.kind === "personal") {
    return (
      <main class="page no-tabs">
        <TopBar title="Persönlicher Zugang" kicker="Einladung" />
        <div class="content">
          <SafariHint />
          <div class="card card-pad stack">
            <p class="kicker" style={{ color: "var(--text-2)" }}>
              Zugang für
            </p>
            <h2 style={{ fontSize: "30px" }}>{info.person.name}</h2>
            <p class="muted">
              {info.person.hasAccount
                ? "Mit diesem Link richtest du auf diesem Gerät einen neuen Passkey für deinen bestehenden Zugang ein."
                : "Mit diesem Link richtest du deinen Zugang ein. Dein Login ist ein Passkey: Face ID, Fingerabdruck oder die Gerätesperre."}
            </p>
            {info.revokeExisting ? <Notice kind="yellow">Deine bisherigen Passkeys und Anmeldungen werden dabei abgemeldet.</Notice> : null}
          </div>
          {needsEmail ? <EmailField value={email} onInput={setEmail} required={emailRequired} /> : null}
          <Button
            variant="primary"
            size="lg"
            block
            icon="key"
            disabled={!joinBody()}
            onClick={async () => {
              const body = joinBody();
              if (!body) return;
              try {
                await registerPasskey("/join", body);
              } catch (err) {
                toast(passkeyErrorMessage(err, "register"), "error");
                return;
              }
              await finish("Dein Passkey ist eingerichtet. Ab jetzt meldest du dich damit an.");
            }}
          >
            Passkey einrichten (empfohlen)
          </Button>
          <p class="small muted">Der Passkey ist die sicherste Anmeldung: Face ID, Fingerabdruck oder Gerätesperre, ohne Passwort.</p>
          {needsEmail ? <JoinByEmail body={joinBody} email={email.trim()} onDone={() => finish("Dein Zugang ist eingerichtet. Du meldest dich per E-Mail-Code an.")} /> : null}
          <p class="small muted">Gültig bis {fullDate(isoToLocalDate(info.expiresAt))}. Der Link funktioniert nur einmal.</p>
        </div>
      </main>
    );
  }

  const isParent = info.kind === "parent";
  const toggle = (id: number) => {
    setFormError(null);
    if (isParent) setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else setSelected([id]);
  };
  const chosen = info.persons.filter((p) => selected.includes(p.id));
  const nameCounts = new Map<string, number>();
  for (const p of info.persons) nameCounts.set(p.name.toLowerCase(), (nameCounts.get(p.name.toLowerCase()) ?? 0) + 1);
  const ambiguous = (name: string) => (nameCounts.get(name.toLowerCase()) ?? 0) > 1;

  const submit = async () => {
    setFormError(null);
    if (isParent && me) {
      await api.post("/join/link-children", { token, childIds: selected });
      await finish(`${chosen.map((c) => c.name).join(" und ")} ${chosen.length > 1 ? "sind" : "ist"} jetzt mit deinem Zugang verknüpft.`);
      return;
    }
    if (isParent && (!firstName.trim() || !lastName.trim())) {
      setFormError("Bitte gib deinen Vor- und Nachnamen ein.");
      return;
    }
    if (!selected.length) {
      setFormError(isParent ? "Bitte wähle mindestens ein Kind aus." : "Bitte wähle deinen Namen aus.");
      return;
    }
    const body = joinBody();
    if (!body) {
      setFormError("Bitte gib eine gültige E-Mail-Adresse an.");
      return;
    }
    try {
      await registerPasskey("/join", body);
    } catch (err) {
      setFormError(passkeyErrorMessage(err, "register"));
      if (!isParent) void load();
      return;
    }
    await finishTeamJoin();
  };

  const finishTeamJoin = () =>
    finish(
      isParent
        ? `Du bist jetzt mit ${chosen.map((c) => c.name.split(" ")[0]).join(" und ")} verknüpft und siehst alle Termine der ${info.team.name}.`
        : `Hallo ${chosen[0]?.name.split(" ")[0]}! Du siehst jetzt deine Termine und kannst zu- und absagen.`,
    );

  return (
    <main class="page no-tabs">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">Einladung</div>
          <div class="team-badge">{info.team.name}</div>
        </div>
        <h1>{isParent ? "Für Eltern" : "Für Spielerinnen und Spieler"}</h1>
        <div class="hero-sub">
          {isParent
            ? `Du richtest einen Elternzugang für die ${info.team.name} ein.`
            : `Du richtest deinen eigenen Zugang für die ${info.team.name} ein.`}
        </div>
      </header>
      <div class="content">
        <SafariHint />
        {isParent && me ? (
          <Notice kind="yellow">Du bist als {info.loggedInAs} angemeldet. Wähle das Kind aus, das du zusätzlich verknüpfen möchtest.</Notice>
        ) : null}
        {!isParent && me ? (
          <Notice kind="yellow">
            Auf diesem Gerät ist gerade {info.loggedInAs} angemeldet. Wenn du fortfährst, wird ein Zugang für die ausgewählte Person angelegt und diese angemeldet.
          </Notice>
        ) : null}
        {isParent && !me ? (
          <ExistingParentLogin
            onLoggedIn={async () => {
              await refresh();
              await load();
            }}
          />
        ) : null}
        {isParent && !me ? <h2 class="section-title">Noch kein Zugang? Dann hier neu einrichten</h2> : null}
        {isParent && !me ? (
          <div class="stack">
            <TextField label="Dein Vorname" value={firstName} onInput={setFirstName} autoComplete="given-name" maxLength={50} />
            <TextField label="Dein Nachname" value={lastName} onInput={setLastName} autoComplete="family-name" maxLength={50} />
          </div>
        ) : null}
        <div class="stack-sm">
          <h2 class="section-title">{isParent ? "Dein Kind (eins oder mehrere)" : "Wer bist du?"}</h2>
          <ul class="list" role={isParent ? "group" : "radiogroup"} aria-label={isParent ? "Kinder" : "Spielerinnen und Spieler"}>
            {info.persons.map((p) => (
              <PersonChoice
                key={p.id}
                name={p.name}
                multi={isParent}
                selected={selected.includes(p.id) || p.linkedToMe}
                disabled={p.taken || p.linkedToMe || ambiguous(p.name)}
                note={
                  p.taken
                    ? "hat schon einen Zugang"
                    : p.linkedToMe
                      ? "bereits mit dir verknüpft"
                      : ambiguous(p.name)
                        ? "Name doppelt, der Trainer ergänzt noch den Nachnamen"
                        : undefined
                }
                onSelect={() => toggle(p.id)}
              />
            ))}
          </ul>
          {!isParent ? <p class="small muted">Dein Name fehlt oder ist schon vergeben? Sag deinem Trainer Bescheid.</p> : null}
        </div>
        {needsEmail ? <EmailField value={email} onInput={setEmail} /> : null}
        {formError ? (
          <div class="notice warn" role="alert">
            <Icon name="alert" />
            <div>{formError}</div>
          </div>
        ) : null}
        <Button variant="primary" size="lg" block icon={isParent && me ? "link" : "key"} onClick={submit}>
          {isParent && me
            ? "Kind verknüpfen"
            : !isParent && chosen[0]
              ? `Ich bin ${chosen[0].name.split(" ")[0]} – Passkey einrichten`
              : "Passkey einrichten (empfohlen)"}
        </Button>
        {!(isParent && me) ? (
          <p class="small muted">
            Der Passkey ist die sicherste Anmeldung: Face ID, Fingerabdruck oder Gerätesperre, ohne Passwort. Die App bekommt dabei nie biometrische Daten zu
            sehen.
          </p>
        ) : null}
        {needsEmail ? <JoinByEmail body={joinBody} email={email.trim()} onDone={finishTeamJoin} /> : null}
      </div>
    </main>
  );
}

/**
 * Elternlink ohne Anmeldung: Wer schon einen Elternzugang hat (z. B. für ein Geschwisterkind),
 * meldet sich zuerst an und verknüpft dann das Kind. Sonst entsteht ein zweiter Zugang.
 */
function ExistingParentLogin({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const send = async () => setRequestId(await startEmailLogin(email));
  return (
    <section class="notice yellow" style={{ flexDirection: "column", alignItems: "stretch", gap: "10px" }} aria-label="Schon einen Elternzugang?">
      <div>
        <strong>Bist du schon in der App registriert? Dann öffne diesen Link auf dem Gerät, auf dem die App installiert ist!</strong> Oder melde dich hier an
        und verknüpfe danach dieses Kind mit deinem Zugang. Sonst entsteht ein zweiter Zugang für dich.
      </div>
      {!emailMode ? (
        <div class="btn-row">
          <Button
            variant="primary"
            icon="key"
            onClick={async () => {
              try {
                await loginWithPasskey();
              } catch (err) {
                toast(passkeyErrorMessage(err, "login"), "error");
                return;
              }
              await onLoggedIn();
            }}
          >
            Mit Passkey anmelden
          </Button>
          <Button icon="mail" onClick={() => setEmailMode(true)}>
            Code per E-Mail
          </Button>
        </div>
      ) : requestId ? (
        <EmailCodeForm requestId={requestId} email={email.trim()} onDone={onLoggedIn} onResend={send} />
      ) : (
        <div class="stack-sm">
          <TextField label="E-Mail-Adresse deines Zugangs" value={email} onInput={setEmail} type="email" autoComplete="email" />
          <Button variant="primary" icon="mail" disabled={!isEmail(email)} onClick={send}>
            Code senden
          </Button>
        </div>
      )}
    </section>
  );
}

/** Optional, außer für Admins: Ohne Passkey ersetzt der Trainer den Zugang per persönlichem Link. */
function EmailField(props: { value: string; onInput: (v: string) => void; required?: boolean }) {
  return (
    <TextField
      label={props.required ? "Deine E-Mail-Adresse" : "Deine E-Mail-Adresse (optional)"}
      type="email"
      value={props.value}
      onInput={props.onInput}
      autoComplete="email"
      inputMode="email"
      maxLength={254}
      hint={
        props.required
          ? "Für Admins Pflicht. Damit kommst du auch ohne Passkey per Code in die App."
          : "Nur nötig, wenn du dich ohne Passkey per Code anmelden möchtest. In der App sieht sie niemand sonst."
      }
    />
  );
}

/** Zugang ohne Passkey: Code an die angegebene Adresse schicken und eingeben lassen. */
function JoinByEmail(props: { body: () => Record<string, unknown> | null; email: string; onDone: () => Promise<void> }) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const send = async () => {
    if (!isEmail(props.email)) {
      toast("Für den Code per E-Mail brauchen wir deine E-Mail-Adresse.", "error");
      return;
    }
    const body = props.body();
    if (!body) return;
    try {
      setRequestId((await api.post<{ requestId: string }>("/join/email", body)).requestId);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  if (requestId) return <EmailCodeForm requestId={requestId} email={props.email} onDone={props.onDone} onResend={send} />;
  return (
    <Button variant="ghost" icon="mail" onClick={send}>
      Ohne Passkey: Code per E-Mail
    </Button>
  );
}

/** Auf dem iPhone nur in Safari einrichten, sonst findet die App vom Home-Bildschirm den Passkey nicht. */
function SafariHint() {
  if (!isIosOtherBrowser()) return null;
  return (
    <Notice kind="warn">
      Bitte öffne diesen Link in <strong>Safari</strong>. Passkeys, die in einem anderen Browser angelegt werden, kann die App auf dem Home-Bildschirm oft nicht
      nutzen. Link kopieren, Safari öffnen und in die Adresszeile einfügen.
    </Notice>
  );
}

export function BootstrapPage() {
  useDocumentTitle("Einrichtung");
  const { refresh } = useSession();
  const [token] = useState(tokenFromHash);
  const [info, setInfo] = useState<{ name: string; email: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .post<{ name: string; email: string | null }>("/bootstrap/info", { token })
      .then((res) => {
        setInfo(res);
        void prepareRegistration("/bootstrap", { token });
      })
      .catch(setError);
  }, [token]);

  if (done) return <Done title="Admin-Zugang" text="Dein Admin-Zugang ist eingerichtet. Der Einrichtungslink ist jetzt ungültig." />;

  return (
    <main class="page no-tabs">
      <TopBar title="Einrichtung" kicker={clubName()} />
      <div class="content">
        <SafariHint />
        {error ? <ErrorBox error={error} /> : null}
        {!info && !error ? <Spinner /> : null}
        {info ? (
          <>
            <div class="card card-pad stack">
              <p class="kicker" style={{ color: "var(--text-2)" }}>
                Admin-Zugang für
              </p>
              <h2 style={{ fontSize: "30px" }}>{info.name}</h2>
              {info.email ? <p class="muted">{info.email}</p> : null}
              <p class="muted">Richte jetzt deinen Passkey ein. Der Einrichtungslink funktioniert nur ein einziges Mal.</p>
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              icon="key"
              onClick={async () => {
                try {
                  await registerPasskey("/bootstrap", { token });
                } catch (err) {
                  toast(passkeyErrorMessage(err, "register"), "error");
                  return;
                }
                clearCache();
                await refresh();
                setDone(true);
              }}
            >
              Passkey einrichten
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
