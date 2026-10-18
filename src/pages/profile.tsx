import { clubName } from "../club";
import { MyCalendar } from "../calendar";
import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { ChildPermission, ChildPermissions, NotificationTopic, PersonRef } from "../../shared/types";
import { CHILD_PERMISSION_LABELS, NOTIFICATION_TOPIC_LABELS } from "../../shared/types";
import { api, ApiError, errorMessage } from "../api";
import { personName, stamp } from "../format";
import { AvatarEditor, PersonAvatar } from "../avatar";
import { EmailCodeForm, isEmail } from "../email";
import { Icon } from "../icons";
import { isIos, isStandalone, registerPasskey, useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, copyText, ErrorBox, Notice, shareLink, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { renderSVG } from "uqr";
import { InstallHint } from "./login";

const ROLE_LABEL: Record<string, string> = { player: "Spieler/in", coach: "Trainer/in", helper: "Aushilfe" };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on";

function PushCard() {
  const me = useMe();
  const [state, setState] = useState<PushState>("loading");

  const check = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  };

  useEffect(() => {
    void check();
  }, []);

  const enable = async () => {
    if (!me.vapidPublicKey) throw new Error("Push ist auf dem Server noch nicht eingerichtet.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "denied" : "off");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const key = urlBase64ToUint8Array(me.vapidPublicKey);
    let sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    try {
      await api.post("/push/subscriptions", sub.toJSON());
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "endpoint_taken")) throw err;
      // Endpoint known for another account with other keys: a fresh subscription gets a new endpoint
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api.post("/push/subscriptions", sub.toJSON());
    }
    setState("on");
    toast("Benachrichtigungen sind aktiv.");
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.del("/push/subscriptions", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setState("off");
    toast("Benachrichtigungen auf diesem Gerät ausgeschaltet.");
  };

  return (
    <section class="card card-body" aria-label="Push-Benachrichtigungen">
      <div class="row-gap">
        <Icon name="bell" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          Benachrichtigungen
        </h2>
        {state === "on" ? <span class="pill pill-yes">Aktiv</span> : null}
      </div>
      {state === "loading" ? <Spinner /> : null}
      {state === "needs-install" ? (
        <>
          <p>Auf dem iPhone funktionieren Benachrichtigungen nur, wenn die App auf dem Home-Bildschirm installiert ist.</p>
          <InstallHint />
        </>
      ) : null}
      {state === "unsupported" ? <p class="muted">Dieser Browser unterstützt keine Push-Benachrichtigungen.</p> : null}
      {state === "denied" ? (
        <p class="muted">Benachrichtigungen sind für diese App in den Einstellungen deines Geräts blockiert. Erlaube sie dort, dann kannst du sie hier aktivieren.</p>
      ) : null}
      {state === "off" ? (
        <>
          <p class="muted">Erfahre sofort von neuen Terminen, Absagen, Nominierungen und Chatnachrichten.</p>
          <Button variant="primary" icon="bell" onClick={enable}>
            Auf diesem Gerät aktivieren
          </Button>
        </>
      ) : null}
      {state === "on" ? (
        <div class="btn-row">
          <Button
            size="sm"
            onClick={async () => {
              await api.post("/push/test");
              toast("Test-Benachrichtigung ist unterwegs.");
            }}
          >
            Testen
          </Button>
          <Button size="sm" variant="ghost" onClick={disable}>
            Ausschalten
          </Button>
        </div>
      ) : null}
      <a class="list-row" href="/profil/benachrichtigungen" style={{ padding: "8px 0", minHeight: "44px" }}>
        <span class="main">
          <span style={{ fontWeight: 600 }}>Was soll ich bekommen?</span>
          <span class="sub">Themen pro Person einstellen</span>
        </span>
        <Icon name="chevron" size={18} />
      </a>
    </section>
  );
}

function NameSheet({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { refresh } = useSession();
  const [first, setFirst] = useState(me.person.firstName);
  const [last, setLast] = useState(me.person.lastName ?? "");
  return (
    <Sheet open onClose={onClose} title="Name ändern">
      <TextField label="Vorname" value={first} onInput={setFirst} maxLength={50} autoComplete="given-name" />
      <TextField label="Nachname" value={last} onInput={setLast} maxLength={50} autoComplete="family-name" />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!first.trim()}
        onClick={async () => {
          await api.patch(`/persons/${me.person.id}`, { firstName: first.trim(), lastName: last.trim() || null });
          await refresh();
          toast("Gespeichert.");
          onClose();
        }}
      >
        Speichern
      </Button>
    </Sheet>
  );
}

/** Admin, der auch Trainer ist: Admin-Rechte ruhen lassen und als Trainer arbeiten (gilt für alle Geräte). */
function AdminModeSwitch({ coachMode }: { coachMode: boolean }) {
  const { refresh } = useSession();
  const { route } = useLocation();
  return (
    <ul class="list" aria-label="Ansicht">
      <li>
        <SwitchRow
          label="Als Admin arbeiten"
          sub={coachMode ? "Aus: Du siehst die App wie ein Trainer, ohne Verwaltung und ohne Admin-Rechte." : "An: Verwaltung und alle Mannschaften. Aus: nur deine Mannschaften, wie ein Trainer."}
          checked={!coachMode}
          onChange={async (admin) => {
            await api.put("/profile/admin-mode", { coachMode: !admin });
            invalidate("/");
            await refresh();
            toast(admin ? "Admin-Ansicht an." : "Du arbeitest jetzt als Trainer.");
            route("/profil", true);
          }}
        />
      </li>
    </ul>
  );
}

export function ProfilePage() {
  useDocumentTitle("Profil");
  const me = useMe();
  const { logout } = useSession();
  const { route } = useLocation();
  const [nameOpen, setNameOpen] = useState(false);
  return (
    <main class="page">
      <header class="hero hero-avatar">
        <PersonAvatar personId={me.person.id} name={me.person.firstName} size={56} />
        <div class="kicker">Profil</div>
        <h1>{personName(me.person)}</h1>
        <div class="hero-sub">
          {[
            ...me.memberships.map((m) => (me.groupIds.includes(m.id) ? `${m.role === "coach" ? "Verantwortlich" : "Mitglied"} ${m.name}` : `${ROLE_LABEL[m.role]} ${m.name}`)),
            ...(me.children.length ? [`Elternteil von ${me.children.map((c) => c.firstName).join(" und ")}`] : []),
            ...(me.isAdmin ? ["Admin"] : []),
          ].join(" · ") || "Mitglied"}
        </div>
      </header>
      <div class="content">
        {me.parentsInCharge ? (
          <Notice>Deine Eltern sind mit deinem Zugang verknüpft. Sie legen fest, was du selbst in der App machen kannst.</Notice>
        ) : null}

        <AvatarEditor personId={me.person.id} name={personName(me.person)} view="self" />

        {me.adminSwitch ? <AdminModeSwitch coachMode={me.adminSwitch.coachMode} /> : null}

        {me.children.length ? (
          <section class="stack-sm" aria-label="Meine Kinder">
            <h2 class="section-title">Meine Kinder</h2>
            <ul class="list">
              {me.children.map((c) => (
                <li>
                  <a class="list-row" href={`/profil/kind/${c.id}`}>
                    <PersonAvatar personId={c.id} name={c.firstName} />
                    <span class="main">
                      <span class="title">{personName(c)}</span>
                      <span class="sub">
                        {c.teams.map((t) => (t.parentsEnabled ? t.name : `${t.name} (ohne Eltern)`)).join(", ") || "keine Mannschaft"}
                        {c.parentsInCharge ? " · Profilbild, Freigaben und Benachrichtigungen" : " · Profilbild"}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {me.helperTeams.length ? <SkillSwitches /> : null}

        <MyCalendar />

        <PushCard />

        <ul class="list">
          <li>
            <a class="list-row" href="/profil/geraete">
              <Icon name="key" size={22} />
              <span class="main">
                <span class="title">Passkeys und Geräte</span>
                <span class="sub">Anmeldung per Passkey oder E-Mail, Geräte</span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
          <li>
            <button type="button" class="list-row" onClick={() => setNameOpen(true)}>
              <Icon name="edit" size={22} />
              <span class="main">
                <span class="title">Name ändern</span>
              </span>
            </button>
          </li>
          {!me.isAdmin && me.manageableTeams.length ? (
            <li>
              <a class="list-row" href="/hilfe">
                <Icon name="info" size={22} />
                <span class="main">
                  <span class="title">Hilfe und Feedback</span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          ) : null}
          <li>
            <a class="list-row" href="/datenschutz">
              <Icon name="shield" size={22} />
              <span class="main">
                <span class="title">Datenschutz und Quellen</span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        </ul>
        <InstallHint />
        <Button
          variant="ghost"
          icon="logout"
          onClick={async () => {
            if (!(await confirmDialog({ title: "Abmelden?", message: "Du kannst dich jederzeit wieder mit deinem Passkey anmelden.", confirmLabel: "Abmelden" }))) return;
            await logout();
            // Nach der nächsten Anmeldung geht es mit den Terminen los
            route("/", true);
          }}
        >
          Abmelden
        </Button>
      </div>
      {nameOpen ? <NameSheet onClose={() => setNameOpen(false)} /> : null}
    </main>
  );
}

interface PermissionsResponse {
  permissions: ChildPermissions;
  parentsInCharge: boolean;
  labels: Record<ChildPermission, string>;
  childHasAccount: boolean;
  guardians: { firstName: string; lastName: string | null; hasAccount: boolean }[];
  log: { permission: ChildPermission; value: boolean; at: string; byName: string }[];
}

/** Eltern richten den Zugang ihres Kindes ein bzw. erzeugen nach Handywechsel einen Link für einen neuen Passkey. */
function ChildAccessCard({ child, hasAccount }: { child: PersonRef; hasAccount: boolean }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const label = hasAccount ? "Link für neuen Passkey" : `Zugang für ${child.firstName} einrichten`;
  return (
    <section class="card card-body stack-sm" aria-label="Zugang des Kindes">
      <h2 class="section-title" style={{ margin: 0 }}>
        Zugang für {child.firstName}
      </h2>
      <p class="small muted">
        {hasAccount
          ? `Neues Handy? Mit diesem Link richtet ${child.firstName} einen neuen Passkey ein. Der bisherige bleibt gültig.`
          : `${child.firstName} bekommt einen eigenen Zugang mit Passkey. Den Link nur ${child.firstName} geben oder direkt auf dem Handy öffnen.`}
      </p>
      {link ? (
        <>
          <div class="url-box">{link.url}</div>
          <div class="btn-row">
            <Button icon="copy" onClick={() => copyText(link.url, "Link kopiert.")}>
              Kopieren
            </Button>
            <Button icon="share" onClick={() => shareLink(`Zugang für ${child.firstName}`, `Dein Zugang zur App ${clubName()}`, link.url)}>
              Teilen
            </Button>
          </div>
          <div class="qr" role="img" aria-label="QR-Code des Links" dangerouslySetInnerHTML={{ __html: renderSVG(link.url, { border: 1 }) }} />
          <p class="small muted">7 Tage gültig, nur einmal nutzbar.</p>
        </>
      ) : (
        <Button
          variant="primary"
          icon="key"
          onClick={async () => {
            setLink(await api.post<{ url: string; expiresAt: string }>(`/persons/${child.id}/personal-link`, {}));
          }}
        >
          {label}
        </Button>
      )}
    </section>
  );
}

export function ChildPage({ id }: { id: string }) {
  const me = useMe();
  const child = me.children.find((c) => String(c.id) === id);
  useDocumentTitle(child ? child.firstName : "Kind");
  const { data, error, reload, mutate } = useQuery<PermissionsResponse>(child ? `/children/${id}/permissions` : null);
  if (!child) {
    return (
      <main class="page">
        <TopBar title="Kind" back="/profil" />
        <div class="content">
          <Notice kind="warn">Dieses Kind ist nicht mit deinem Zugang verknüpft.</Notice>
        </div>
      </main>
    );
  }
  return (
    <main class="page">
      <TopBar title={personName(child)} kicker="Profilbild und Freigaben" back="/profil" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        <AvatarEditor personId={child.id} name={personName(child)} view="guardian" />
        {!data ? <Spinner /> : null}
        {data && !data.parentsInCharge ? (
          <Notice>
            In den Mannschaften von {child.firstName} sind keine Eltern eingebunden. {child.firstName} sagt selbst zu und ab und ist allein im Chat. Freigaben und
            Benachrichtigungen für {child.firstName} gibt es deshalb nicht.
          </Notice>
        ) : null}
        {data?.parentsInCharge ? (
          <>
            <Notice>
              {data.childHasAccount
                ? `${child.firstName} hat einen eigenen Zugang. Hier legst du fest, was ${child.firstName} selbst darf. Du kannst immer für ${child.firstName} zu- und absagen.`
                : `${child.firstName} hat noch keinen eigenen Zugang. Die Freigaben gelten, sobald ${child.firstName} einen bekommt.`}
            </Notice>
            <ChildAccessCard child={child} hasAccount={data.childHasAccount} />
            <ul class="list" aria-label="Freigaben">
              {(Object.keys(CHILD_PERMISSION_LABELS) as ChildPermission[]).map((perm) => (
                <li>
                  <SwitchRow
                    label={CHILD_PERMISSION_LABELS[perm]}
                    checked={data.permissions[perm]}
                    onChange={async (value) => {
                      const res = await api.put<{ permissions: ChildPermissions }>(`/children/${id}/permissions`, { permission: perm, value });
                      mutate({ ...data, permissions: res.permissions });
                      toast("Gespeichert. Das andere Elternteil wird informiert.");
                      void reload();
                    }}
                  />
                </li>
              ))}
            </ul>
            <p class="small muted">
              Verknüpfte Eltern: {data.guardians.map((g) => `${personName(g)}${g.hasAccount ? "" : " (ohne Zugang)"}`).join(", ")}. Jedes Elternteil kann die Freigaben
              ändern.
            </p>
            {data.log.length ? (
              <section class="stack-sm" aria-label="Änderungen">
                <h2 class="section-title">Letzte Änderungen</h2>
                <ul class="list">
                  {data.log.map((l) => (
                    <li class="list-row">
                      <span class="main">
                        <span>
                          {CHILD_PERMISSION_LABELS[l.permission]}: <strong>{l.value ? "erlaubt" : "aus"}</strong>
                        </span>
                        <span class="sub">
                          {l.byName}, {stamp(l.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <a class="btn" href="/profil/benachrichtigungen">
              Benachrichtigungen für {child.firstName}
            </a>
          </>
        ) : null}
      </div>
    </main>
  );
}

interface NotificationSettings {
  persons: { person: PersonRef; self: boolean; topics: Partial<Record<NotificationTopic, boolean>> }[];
}

export function NotificationsPage() {
  useDocumentTitle("Benachrichtigungen");
  const me = useMe();
  const { data, error, reload, mutate } = useQuery<NotificationSettings>("/me/notifications");
  return (
    <main class="page">
      <TopBar title="Benachrichtigungen" kicker="Einstellungen" back="/profil" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data ? <Spinner /> : null}
        {data?.persons.map((p) => (
          <section class="stack-sm" aria-label={p.self ? "Für mich" : `Für ${p.person.firstName}`}>
            <h2 class="section-title">{p.self ? "Für mich" : `Für ${p.person.firstName}`}</h2>
            <ul class="list">
              {(Object.keys(p.topics) as NotificationTopic[]).map((topic) => (
                <li>
                  <SwitchRow
                    label={NOTIFICATION_TOPIC_LABELS[topic]}
                    checked={p.topics[topic] ?? true}
                    onChange={async (enabled) => {
                      await api.put("/me/notifications", { personId: p.person.id, topic, enabled });
                      mutate({ persons: data.persons.map((x) => (x.person.id === p.person.id ? { ...x, topics: { ...x.topics, [topic]: enabled } } : x)) });
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {me.helperTeams.length || me.referee ? <HelperPrefs /> : null}
        <p class="small muted">Die Einstellungen gelten für alle deine Geräte. Ob ein Gerät überhaupt Benachrichtigungen bekommt, legst du im Profil fest.</p>
      </div>
    </main>
  );
}

type DutyTopic = "duty_remind_3d" | "duty_remind_1d" | "duty_open" | "duty_coach_open" | "duty_referee_open";
const DUTY_TOPIC_LABELS: Record<DutyTopic, string> = {
  duty_remind_3d: "Erinnerung 3 Tage vor meinem Dienst",
  duty_remind_1d: "Erinnerung 1 Tag vorher",
  duty_open: "Helfer gesucht bei meinen Mannschaften",
  duty_coach_open: "Offene Plätze (Trainer und Admins)",
  duty_referee_open: "KiHaSL/JuHaSL gesucht",
};

interface DutyPrefs {
  skills: { dutyTypeId: number; code: string | null; name: string; on: boolean }[];
  channels: Record<DutyTopic, { push: boolean; mail: boolean }>;
  mailAddressVerified: boolean;
}

/** Helferplan „Das kann ich“: Dienste mit Vorkenntnissen bietet der Helferplan nur nach Zustimmung an. */
function SkillSwitches() {
  const { data, mutate } = useQuery<DutyPrefs>("/profile/duty-prefs");
  if (!data?.skills.length) return null;
  // Zeitnehmer und Sekretär sind dieselbe Qualifikation: ein Schalter, intern zwei Zustimmungen
  const table = data.skills.filter((sk) => sk.code === "zeitnehmer" || sk.code === "sekretaer");
  const rows = [
    ...(table.length ? [{ label: table.map((sk) => sk.name).join(" und "), items: table }] : []),
    ...data.skills.filter((sk) => !table.includes(sk)).map((sk) => ({ label: sk.name, items: [sk] })),
  ];
  return (
    <section class="stack-sm" aria-label="Das kann ich">
      <h2 class="section-title">Das kann ich</h2>
      <ul class="list">
        {rows.map((row) => (
          <li>
            <SwitchRow
              label={row.label}
              checked={row.items.every((sk) => sk.on)}
              onChange={async (on) => {
                const ids = row.items.map((sk) => sk.dutyTypeId);
                await api.put("/profile/duty-prefs", { skills: ids.map((dutyTypeId) => ({ dutyTypeId, on })) });
                mutate({ ...data, skills: data.skills.map((x) => (ids.includes(x.dutyTypeId) ? { ...x, on } : x)) });
                invalidate("/duties");
              }}
            />
          </li>
        ))}
      </ul>
      <p class="small muted">Diese Dienste brauchen Vorkenntnisse. Der Helferplan bietet sie dir nur an, wenn du sie hier einschaltest.</p>
    </section>
  );
}

/** Helferplan: je Benachrichtigung Push und/oder Mail. */
function HelperPrefs() {
  const me = useMe();
  const { data, mutate } = useQuery<DutyPrefs>("/profile/duty-prefs");
  if (!data) return <Spinner />;
  const showCoach = me.isAdmin || me.manageableTeams.length > 0;
  const topics = (Object.keys(DUTY_TOPIC_LABELS) as DutyTopic[]).filter(
    (t) => (t !== "duty_coach_open" || showCoach) && (t !== "duty_referee_open" || me.referee) && (t !== "duty_open" || me.helperTeams.length > 0),
  );
  const setChannel = async (topic: DutyTopic, ch: { push: boolean; mail: boolean }) => {
    await api.put("/profile/duty-prefs", { channels: { [topic]: ch } });
    mutate({ ...data, channels: { ...data.channels, [topic]: ch } });
  };
  return (
    <section class="stack-sm" aria-label="Helferplan">
      <h2 class="section-title">Helferplan</h2>
      <div class="duty-channels" role="table" aria-label="Benachrichtigungen im Helferplan">
        <div role="row" class="head">
          <span role="columnheader">Benachrichtigung</span>
          <span role="columnheader">Push</span>
          <span role="columnheader">Mail</span>
        </div>
        {topics.map((t) => (
          <div role="row">
            <span role="cell">{DUTY_TOPIC_LABELS[t]}</span>
            <span role="cell">
              <input type="checkbox" aria-label={`${DUTY_TOPIC_LABELS[t]} per Push`} checked={data.channels[t].push} onChange={(e) => setChannel(t, { ...data.channels[t], push: (e.target as HTMLInputElement).checked })} />
            </span>
            <span role="cell">
              <input
                type="checkbox"
                aria-label={`${DUTY_TOPIC_LABELS[t]} per Mail`}
                checked={data.channels[t].mail}
                onChange={(e) => setChannel(t, { ...data.channels[t], mail: (e.target as HTMLInputElement).checked })}
              />
            </span>
          </div>
        ))}
      </div>
      {!data.mailAddressVerified ? (
        <p class="small muted">Mails gehen an die bestätigte Adresse deiner Anmeldung. Du hast noch keine, trage sie unter <a href="/profil/geraete">Profil → Anmeldung</a> ein.</p>
      ) : (
        <p class="small muted">Mails gehen an die Adresse, mit der du dich anmeldest.</p>
      )}
    </section>
  );
}

interface Security {
  email: string | null;
  emailVerified: boolean;
  passkeys: { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; synced: boolean }[];
  sessions: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; current: boolean }[];
}

/** Adresse für die Anmeldung per E-Mail-Code. Sieht niemand außer dir. */
function EmailSection(props: { data: Security; reload: () => Promise<unknown> }) {
  const { data } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(data.email ?? "");
  const [pending, setPending] = useState<{ requestId: string; email: string } | null>(null);

  const save = async (email: string) => {
    const res = await api.put<{ verified: boolean; requestId?: string }>("/me/email", { email });
    await props.reload();
    if (res.requestId) setPending({ requestId: res.requestId, email });
    setEditing(false);
  };

  return (
    <section class="stack-sm" aria-label="E-Mail für die Anmeldung">
      <h2 class="section-title">E-Mail für die Anmeldung</h2>
      <div class="card card-pad stack-sm">
        {pending ? (
          <EmailCodeForm
            requestId={pending.requestId}
            email={pending.email}
            onDone={async () => {
              setPending(null);
              toast("E-Mail-Adresse bestätigt.");
              await props.reload();
            }}
            onResend={() => save(pending.email)}
          />
        ) : editing ? (
          <>
            <TextField label="E-Mail-Adresse" type="email" value={value} onInput={setValue} autoComplete="email" inputMode="email" maxLength={254} />
            <div class="btn-row">
              <Button variant="primary" disabled={!isEmail(value)} onClick={() => save(value.trim().toLowerCase())}>
                Code senden
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Abbrechen
              </Button>
            </div>
          </>
        ) : (
          <>
            {data.email ? (
              <p>
                <strong>{data.email}</strong>
                <br />
                <span class="small muted">{data.emailVerified ? "Bestätigt. Du kannst dich damit per Code anmelden." : "Noch nicht bestätigt."}</span>
              </p>
            ) : (
              <p class="muted">Noch keine Adresse hinterlegt. Mit einer bestätigten Adresse kommst du per Code wieder in die App, falls dein Passkey fehlt.</p>
            )}
            <div class="btn-row">
              <Button
                onClick={() => {
                  setValue(data.email ?? "");
                  setEditing(true);
                }}
              >
                {data.email ? "Ändern" : "Adresse hinzufügen"}
              </Button>
              {data.email && !data.emailVerified ? <Button onClick={() => save(data.email!)}>Code senden</Button> : null}
              {data.email && data.passkeys.length ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: "Adresse entfernen?", message: "Danach kannst du dich nur noch mit deinem Passkey anmelden.", confirmLabel: "Entfernen" }))) return;
                    await api.del("/me/email");
                    await props.reload();
                  }}
                >
                  Entfernen
                </Button>
              ) : null}
            </div>
          </>
        )}
        <p class="small muted">Nur für die Anmeldung. Weder Trainer noch Admins sehen die Adresse.</p>
      </div>
    </section>
  );
}

export function DevicesPage() {
  useDocumentTitle("Passkeys und Geräte");
  const { data, error, reload } = useQuery<Security>("/me/security");
  return (
    <main class="page">
      <TopBar title="Passkeys und Geräte" kicker="Sicherheit" back="/profil" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data ? <Spinner /> : null}
        {data ? (
          <>
            {!data.passkeys.length ? (
              <Notice icon="key">
                <strong>Richte einen Passkey ein.</strong> Er ist die sicherste Anmeldung: Face ID, Fingerabdruck oder Gerätesperre, ohne Passwort und ohne Code
                per E-Mail.
              </Notice>
            ) : null}
            <EmailSection data={data} reload={reload} />
            <section class="stack-sm" aria-label="Passkeys">
              <h2 class="section-title">Passkeys</h2>
              <ul class="list">
                {data.passkeys.map((p) => (
                  <li class="list-row">
                    <Icon name="key" size={22} />
                    <span class="main">
                      <span class="title">{p.label ?? "Passkey"}</span>
                      <span class="sub">
                        Seit {stamp(p.createdAt)}
                        {p.lastUsedAt ? ` · zuletzt ${stamp(p.lastUsedAt)}` : ""}
                        {p.synced ? " · synchronisiert" : ""}
                      </span>
                    </span>
                    {data.passkeys.length > 1 || data.emailVerified ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Passkey entfernen"
                        onClick={async () => {
                          if (!(await confirmDialog({ title: "Passkey entfernen?", message: "Mit diesem Passkey kannst du dich danach nicht mehr anmelden.", confirmLabel: "Entfernen", danger: true }))) return;
                          await api.del(`/me/passkeys/${encodeURIComponent(p.id)}`);
                          await reload();
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Button
                icon="plus"
                onClick={async () => {
                  try {
                    await registerPasskey("/me/passkeys", {});
                    toast("Weiterer Passkey eingerichtet.");
                    await reload();
                  } catch (err) {
                    toast(errorMessage(err), "error");
                  }
                }}
              >
                {data.passkeys.length ? "Weiteren Passkey hinzufügen" : "Passkey einrichten"}
              </Button>
              <p class="small muted">Tipp: Ein zweiter Passkey, z. B. auf einem Tablet, hilft, wenn das Handy verloren geht.</p>
            </section>
            <section class="stack-sm" aria-label="Angemeldete Geräte">
              <h2 class="section-title">Angemeldet auf</h2>
              <ul class="list">
                {data.sessions.map((s) => (
                  <li class="list-row">
                    <Icon name="phone" size={22} />
                    <span class="main">
                      <span class="title">
                        {s.deviceLabel} {s.current ? <span class="badge">Dieses Gerät</span> : null}
                      </span>
                      <span class="sub">Angemeldet seit {stamp(s.createdAt)}</span>
                    </span>
                    {!s.current ? (
                      <Button
                        size="sm"
                        onClick={async () => {
                          await api.del(`/me/sessions/${s.id}`);
                          toast("Gerät abgemeldet.");
                          await reload();
                          invalidate("/me/security");
                        }}
                      >
                        Abmelden
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
