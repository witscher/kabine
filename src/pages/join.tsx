import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { isWorkersDevHost } from "../../shared/addresses";
import { clubName } from "../club";
import { useSignInMethods } from "../sign-in-methods";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { EmailCodeForm, isEmail, startEmailLogin } from "../email";
import { fullDate, isoToLocalDate, joinNames } from "../format";
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
      person: { name: string; hasAccount: boolean; isAdmin: boolean; email?: string | null };
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
            <h2 style={{ fontSize: "26px" }}>
              <Trans>All done!</Trans>
            </h2>
          </div>
          <p>{props.text}</p>
        </div>
        <InstallHint />
        <Button variant="primary" size="lg" block onClick={() => route("/", true)}>
          <Trans>Go to the app</Trans>
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
  useDocumentTitle(t`Invitation`);
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
  // Access by e-mail code only once the club has set up sending
  const emailCodes = !!useSignInMethods()?.email;

  const load = async () => {
    setError(null);
    try {
      const res = await api.post<JoinInfo>("/join/info", { token });
      setInfo(res);
      // An admin's address entered with the admin role: no need to type it again
      if (res.kind === "personal" && res.person.email) setEmail(res.person.email);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    if (!token) setError(new Error(t`The link is incomplete. Please open the complete invitation link again.`));
    else void load();
  }, [token]);

  /** New access? Then there is the e-mail address field; it is only mandatory for admins. */
  const needsEmail = !!info && (info.kind === "player" || (info.kind === "parent" && !me) || (info.kind === "personal" && !info.person.hasAccount));
  const emailRequired = !!info && info.kind === "personal" && !info.person.hasAccount && info.person.isAdmin;

  /** Request for passkey and e-mail code, or null as long as something is missing. */
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

  // Prepare passkey options as soon as it is clear what for (iOS, see session.tsx)
  useEffect(() => {
    if (info?.kind === "parent" && me) return;
    if (info?.kind === "parent") void prepareLogin();
    const body = joinBody();
    if (!body) return;
    const timer = window.setTimeout(() => void prepareRegistration("/join", body), 400);
    return () => window.clearTimeout(timer);
  }, [info, me, selected, email, firstName, lastName]);

  if (done) return <Done title={t`Welcome`} text={done} />;

  if (error) {
    return (
      <main class="page no-tabs">
        <TopBar title={t`Invitation`} kicker={clubName()} />
        <div class="content">
          <ErrorBox error={error} />
          <a class="btn" href="/">
            <Trans>Go to sign-in</Trans>
          </a>
        </div>
      </main>
    );
  }
  if (!info) return <Spinner label={t`Checking invitation`} />;

  const finish = async (text: string) => {
    clearCache();
    await refresh();
    setDone(text);
  };

  if (!passkeysSupported()) {
    return (
      <main class="page no-tabs">
        <TopBar title={t`Invitation`} kicker={clubName()} />
        <div class="content">
          <Notice kind="warn">
            <Trans>This browser does not support passkeys. Please open the link in Safari (iPhone) or Chrome (Android).</Trans>
          </Notice>
        </div>
      </main>
    );
  }

  if (info.kind === "personal") {
    const until = fullDate(isoToLocalDate(info.expiresAt));
    return (
      <main class="page no-tabs">
        <TopBar title={t`Personal access`} kicker={t`Invitation`} />
        <div class="content">
          <SafariHint />
          <div class="card card-pad stack">
            <p class="kicker" style={{ color: "var(--text-2)" }}>
              <Trans>Access for</Trans>
            </p>
            <h2 style={{ fontSize: "30px" }}>{info.person.name}</h2>
            <p class="muted">
              {info.person.hasAccount
                ? t`With this link you set up a new passkey on this device for your existing access.`
                : t`With this link you set up your access. Your login is a passkey: Face ID, fingerprint or the screen lock.`}
            </p>
            {info.revokeExisting ? (
              <Notice kind="yellow">
                <Trans>Your previous passkeys and sessions will be signed out.</Trans>
              </Notice>
            ) : null}
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
              await finish(t`Your passkey is set up. From now on you sign in with it.`);
            }}
          >
            <Trans>Set up passkey (recommended)</Trans>
          </Button>
          <p class="small muted">
            <Trans>The passkey is the safest way to sign in: Face ID, fingerprint or screen lock, without a password.</Trans>
          </p>
          {needsEmail && emailCodes ? <JoinByEmail body={joinBody} email={email.trim()} onDone={() => finish(t`Your access is set up. You sign in with an e-mail code.`)} /> : null}
          <p class="small muted">
            <Trans>Valid until {until}. The link only works once.</Trans>
          </p>
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
  const playerName = chosen[0]?.name.split(" ")[0] ?? "";
  const teamName = info.team.name;
  const loggedInAs = info.loggedInAs;

  const submit = async () => {
    setFormError(null);
    if (isParent && me) {
      await api.post("/join/link-children", { token, childIds: selected });
      const names = joinNames(chosen.map((c) => c.name));
      const count = chosen.length;
      await finish(plural(count, { one: `${names} is now linked to your access.`, other: `${names} are now linked to your access.` }));
      return;
    }
    if (isParent && (!firstName.trim() || !lastName.trim())) {
      setFormError(t`Please enter your first and last name.`);
      return;
    }
    if (!selected.length) {
      setFormError(isParent ? t`Please select at least one child.` : t`Please select your name.`);
      return;
    }
    const body = joinBody();
    if (!body) {
      setFormError(t`Please provide a valid e-mail address.`);
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

  const finishTeamJoin = () => {
    const names = joinNames(chosen.map((c) => c.name.split(" ")[0]!));
    return finish(
      isParent
        ? t`You are now linked to ${names} and see all events of the ${teamName}.`
        : t`Hello ${playerName}! You now see your events and can accept or decline.`,
    );
  };

  return (
    <main class="page no-tabs">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">
            <Trans>Invitation</Trans>
          </div>
          <div class="team-badge">{info.team.name}</div>
        </div>
        <h1>{isParent ? t`For parents` : t`For players`}</h1>
        <div class="hero-sub">
          {isParent
            ? t`You are setting up a parent access for the ${teamName}.`
            : t`You are setting up your own access for the ${teamName}.`}
        </div>
      </header>
      <div class="content">
        <SafariHint />
        {isParent && me ? (
          <Notice kind="yellow">
            <Trans>You are signed in as {loggedInAs}. Select the child you want to link in addition.</Trans>
          </Notice>
        ) : null}
        {!isParent && me ? (
          <Notice kind="yellow">
            <Trans>
              {loggedInAs} is currently signed in on this device. If you continue, an access will be created for the selected person and they will be signed in.
            </Trans>
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
        {isParent && !me ? <h2 class="section-title">
            <Trans>No access yet? Then set one up here</Trans>
          </h2> : null}
        {isParent && !me ? (
          <div class="stack">
            <TextField label={t`Your first name`} value={firstName} onInput={setFirstName} autoComplete="given-name" maxLength={50} />
            <TextField label={t`Your last name`} value={lastName} onInput={setLastName} autoComplete="family-name" maxLength={50} />
          </div>
        ) : null}
        <div class="stack-sm">
          <h2 class="section-title">{isParent ? t`Your child (one or more)` : t`Who are you?`}</h2>
          <ul class="list" role={isParent ? "group" : "radiogroup"} aria-label={isParent ? t`Children` : t({ message: "Players", context: "player list" })}>
            {info.persons.map((p) => (
              <PersonChoice
                key={p.id}
                name={p.name}
                multi={isParent}
                selected={selected.includes(p.id) || p.linkedToMe}
                disabled={p.taken || p.linkedToMe || ambiguous(p.name)}
                note={
                  p.taken
                    ? t`has access already`
                    : p.linkedToMe
                      ? t`already linked to you`
                      : ambiguous(p.name)
                        ? t`Duplicate name, the coach will add the last name`
                        : undefined
                }
                onSelect={() => toggle(p.id)}
              />
            ))}
          </ul>
          {!isParent ? (
            <p class="small muted">
              <Trans>Your name is missing or already taken? Let your coach know.</Trans>
            </p>
          ) : null}
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
            ? t`Link child`
            : !isParent && chosen[0]
              ? t`I am ${playerName} – set up passkey`
              : t`Set up passkey (recommended)`}
        </Button>
        {!(isParent && me) ? (
          <p class="small muted">
            <Trans>
              The passkey is the safest way to sign in: Face ID, fingerprint or screen lock, without a password. The app never gets to see any biometric data.
            </Trans>
          </p>
        ) : null}
        {needsEmail && emailCodes ? <JoinByEmail body={joinBody} email={email.trim()} onDone={finishTeamJoin} /> : null}
      </div>
    </main>
  );
}

/**
 * Parent link without being signed in: whoever already has a parent access (e.g. for a sibling)
 * signs in first and then links the child. Otherwise a second access is created.
 */
function ExistingParentLogin({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const emailCodes = !!useSignInMethods()?.email;
  const send = async () => setRequestId(await startEmailLogin(email));
  return (
    <section class="notice yellow" style={{ flexDirection: "column", alignItems: "stretch", gap: "10px" }} aria-label={t`Already have a parent access?`}>
      <div>
        <Trans>
          <strong>Already registered in the app? Then open this link on the device where the app is installed!</strong> Or sign in here and then link this
          child to your access. Otherwise a second access will be created for you.
        </Trans>
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
            <Trans>Sign in with passkey</Trans>
          </Button>
          {emailCodes ? (
            <Button icon="mail" onClick={() => setEmailMode(true)}>
              <Trans>Code by e-mail</Trans>
            </Button>
          ) : null}
        </div>
      ) : requestId ? (
        <EmailCodeForm requestId={requestId} email={email.trim()} onDone={onLoggedIn} onResend={send} />
      ) : (
        <div class="stack-sm">
          <TextField label={t`E-mail address of your access`} value={email} onInput={setEmail} type="email" autoComplete="email" />
          <Button variant="primary" icon="mail" disabled={!isEmail(email)} onClick={send}>
            <Trans>Send code</Trans>
          </Button>
        </div>
      )}
    </section>
  );
}

/** Optional, except for admins: without a passkey the coach replaces the access with a personal link. */
function EmailField(props: { value: string; onInput: (v: string) => void; required?: boolean }) {
  return (
    <TextField
      label={props.required ? t`Your e-mail address` : t`Your e-mail address (optional)`}
      type="email"
      value={props.value}
      onInput={props.onInput}
      autoComplete="email"
      inputMode="email"
      maxLength={254}
      hint={
        props.required
          ? t`Mandatory for admins. With it you can also get into the app by code without a passkey.`
          : t`Only needed if you want to sign in by code without a passkey. Nobody else in the app sees it.`
      }
    />
  );
}

/** Access without a passkey: send a code to the given address and let it be entered. */
function JoinByEmail(props: { body: () => Record<string, unknown> | null; email: string; onDone: () => Promise<void> }) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const send = async () => {
    if (!isEmail(props.email)) {
      toast(t`For the code by e-mail we need your e-mail address.`, "error");
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
      <Trans>Without passkey: code by e-mail</Trans>
    </Button>
  );
}

/** On the iPhone set up only in Safari, otherwise the app on the home screen does not find the passkey. */
function SafariHint() {
  if (!isIosOtherBrowser()) return null;
  return (
    <Notice kind="warn">
      <Trans>
        Please open this link in <strong>Safari</strong>. Passkeys created in another browser often cannot be used by the app on the home screen. Copy the
        link, open Safari and paste it into the address bar.
      </Trans>
    </Notice>
  );
}

interface BootstrapInfo {
  name: string | null;
  email: string | null;
  /** Fresh installation: the first admin enters name and e-mail here. */
  needsPerson: boolean;
}

/**
 * Setup of the first admin. Reached by the setup link (/einrichtung#<password>) or, on a fresh installation,
 * by opening the app at all: then it asks for the setup password chosen when deploying.
 */
export function BootstrapPage() {
  useDocumentTitle(t`Setup`);
  const { refresh } = useSession();
  const [token, setToken] = useState(tokenFromHash);
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState<BootstrapInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  // Passkeys are bound to the host name: on Cloudflare's test address, first point to the club's domain
  const host = location.hostname;
  const [testAddressOk, setTestAddressOk] = useState(!isWorkersDevHost(host));

  const person = info?.needsPerson ? { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() } : null;
  const personReady = !person || (!!person.firstName && !!person.lastName && isEmail(person.email));
  const body = person ? { token, ...person } : { token };

  useEffect(() => {
    if (!token) return;
    setError(null);
    api
      .post<BootstrapInfo>("/bootstrap/info", { token })
      .then((res) => {
        setInfo(res);
        if (!res.needsPerson) void prepareRegistration("/bootstrap", { token });
      })
      .catch((err) => {
        setError(err);
        // A mistyped password can be entered again
        if (!tokenFromHash()) setToken("");
      });
  }, [token]);

  // Fresh installation: prepare the passkey dialog once name and e-mail are complete (as on the invitation page)
  useEffect(() => {
    if (!person || !personReady) return;
    const timer = window.setTimeout(() => void prepareRegistration("/bootstrap", body), 400);
    return () => window.clearTimeout(timer);
  }, [info, firstName, lastName, email]);

  if (done) return <Done title={t`Admin access`} text={t`Your admin access is set up. The setup link is now invalid.`} />;

  return (
    <main class="page no-tabs">
      <TopBar title={t`Setup`} kicker={clubName()} />
      <div class="content">
        <SafariHint />
        {!testAddressOk ? (
          <div class="card card-pad stack">
            <h2 style={{ fontSize: "26px" }}>
              <Trans>First give the app the club's address</Trans>
            </h2>
            <Notice kind="warn">
              <Trans>
                You opened the app at Cloudflare's test address <strong>{host}</strong>. Passkeys only work at the address they were created at: an admin
                access set up here will not work later at the club's own address.
              </Trans>
            </Notice>
            <p>
              <Trans>
                Add a subdomain of the club first, for example <em>app.your-club.org</em>: in the Cloudflare dashboard under{" "}
                <em>Workers &amp; Pages → this Worker → Settings → Domains &amp; Routes → Add → Custom domain</em>. Then open the app at that address and
                continue there.
              </Trans>
            </p>
            <Button variant="secondary" block onClick={() => setTestAddressOk(true)}>
              <Trans>Continue here anyway (only for trying out)</Trans>
            </Button>
          </div>
        ) : null}
        {testAddressOk && !token ? (
          <form
            class="card card-pad stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (password.trim()) setToken(password.trim());
            }}
          >
            <h2 style={{ fontSize: "26px" }}>
              <Trans>Set up Kabine</Trans>
            </h2>
            <p>
              <Trans>
                Kabine is installed. Enter the setup password you chose when deploying (<em>ADMIN_BOOTSTRAP_TOKEN</em>). It works once and makes you the first
                admin.
              </Trans>
            </p>
            {error ? <ErrorBox error={error} /> : null}
            <TextField label={t`Setup password`} type="password" autoComplete="off" value={password} onInput={setPassword} required />
            <Button variant="primary" block type="submit" disabled={!password.trim()}>
              <Trans>Continue</Trans>
            </Button>
          </form>
        ) : null}
        {testAddressOk && token && error ? <ErrorBox error={error} /> : null}
        {testAddressOk && token && !info && !error ? <Spinner /> : null}
        {testAddressOk && info ? (
          <>
            <div class="card card-pad stack">
              <p class="kicker" style={{ color: "var(--text-2)" }}>
                {person ? <Trans>First admin</Trans> : <Trans>Admin access for</Trans>}
              </p>
              {person ? (
                <>
                  <p class="muted">
                    <Trans>You become the first admin and the owner of this installation. Your e-mail address is for signing in; besides you, only other admins see it.</Trans>
                  </p>
                  <TextField label={t`First name`} value={firstName} onInput={setFirstName} autoComplete="given-name" maxLength={60} required />
                  <TextField label={t`Last name`} value={lastName} onInput={setLastName} autoComplete="family-name" maxLength={60} required />
                  <TextField label={t`E-mail address`} type="email" inputMode="email" value={email} onInput={setEmail} autoComplete="email" required />
                </>
              ) : (
                <>
                  <h2 style={{ fontSize: "30px" }}>{info.name}</h2>
                  {info.email ? <p class="muted">{info.email}</p> : null}
                </>
              )}
              <p class="muted">
                <Trans>Set up your passkey now. The setup works a single time only.</Trans>
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              icon="key"
              disabled={!personReady}
              onClick={async () => {
                try {
                  await registerPasskey("/bootstrap", body);
                } catch (err) {
                  toast(passkeyErrorMessage(err, "register"), "error");
                  return;
                }
                clearCache();
                await refresh();
                setDone(true);
              }}
            >
              <Trans>Set up passkey</Trans>
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
