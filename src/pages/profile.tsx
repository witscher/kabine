import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName, useModule } from "../club";
import { MyCalendar } from "../calendar";
import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { ChildPermission, ChildPermissions, NotificationTopic, PersonRef } from "../../shared/types";
import { childPermissionLabels, notificationTopicLabels } from "../../shared/types";
import { api, ApiError, errorMessage } from "../api";
import { personName, stamp, joinNames } from "../format";
import { AvatarEditor, PersonAvatar } from "../avatar";
import { EmailCodeForm, isEmail } from "../email";
import { Icon } from "../icons";
import { LanguageSwitch } from "../language-switch";
import { isIos, isStandalone, registerPasskey, useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, copyText, ErrorBox, Notice, shareLink, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { renderSVG } from "uqr";
import { InstallHint } from "./login";

const roleLabels = (): Record<string, string> => ({
  player: t({ message: "Player", context: "role" }),
  coach: t({ message: "Coach", context: "role" }),
  helper: t({ message: "Stand-in", context: "role" }),
});

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
    if (!me.vapidPublicKey) throw new Error(t`Push is not set up on the server yet.`);
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
    toast(t`Notifications are on.`);
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.del("/push/subscriptions", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setState("off");
    toast(t`Notifications turned off on this device.`);
  };

  return (
    <section class="card card-body" aria-label={t`Push notifications`}>
      <div class="row-gap">
        <Icon name="bell" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          <Trans>Notifications</Trans>
        </h2>
        {state === "on" ? (
          <span class="pill pill-yes">
            <Trans>Active</Trans>
          </span>
        ) : null}
      </div>
      {state === "loading" ? <Spinner /> : null}
      {state === "needs-install" ? (
        <>
          <p>
            <Trans>On the iPhone, notifications only work if the app is installed on the Home Screen.</Trans>
          </p>
          <InstallHint />
        </>
      ) : null}
      {state === "unsupported" ? (
        <p class="muted">
          <Trans>This browser does not support push notifications.</Trans>
        </p>
      ) : null}
      {state === "denied" ? (
        <p class="muted">
          <Trans>Notifications for this app are blocked in your device settings. Allow them there, then you can turn them on here.</Trans>
        </p>
      ) : null}
      {state === "off" ? (
        <>
          <p class="muted">
            <Trans>Hear straight away about new events, cancellations, nominations and chat messages.</Trans>
          </p>
          <Button variant="primary" icon="bell" onClick={enable}>
            <Trans>Turn on for this device</Trans>
          </Button>
        </>
      ) : null}
      {state === "on" ? (
        <div class="btn-row">
          <Button
            size="sm"
            onClick={async () => {
              await api.post("/push/test");
              toast(t`Test notification is on its way.`);
            }}
          >
            <Trans>Test</Trans>
          </Button>
          <Button size="sm" variant="ghost" onClick={disable}>
            <Trans>Turn off</Trans>
          </Button>
        </div>
      ) : null}
      <a class="list-row" href="/profil/benachrichtigungen" style={{ padding: "8px 0", minHeight: "44px" }}>
        <span class="main">
          <span style={{ fontWeight: 600 }}>
            <Trans>What should I receive?</Trans>
          </span>
          <span class="sub">
            <Trans>Choose topics per person</Trans>
          </span>
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
    <Sheet open onClose={onClose} title={t`Change name`}>
      <TextField label={t`First name`} value={first} onInput={setFirst} maxLength={50} autoComplete="given-name" />
      <TextField label={t`Last name`} value={last} onInput={setLast} maxLength={50} autoComplete="family-name" />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!first.trim()}
        onClick={async () => {
          await api.patch(`/persons/${me.person.id}`, { firstName: first.trim(), lastName: last.trim() || null });
          await refresh();
          toast(t`Saved.`);
          onClose();
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </Sheet>
  );
}

/** Admin who is also a coach: suspend admin rights and work as a coach (applies to all devices). */
function AdminModeSwitch({ coachMode }: { coachMode: boolean }) {
  const { refresh } = useSession();
  const { route } = useLocation();
  return (
    <ul class="list" aria-label={t`View`}>
      <li>
        <SwitchRow
          label={t`Work as admin`}
          sub={
            coachMode
              ? t`Off: you see the app like a coach, without administration and without admin rights.`
              : t`On: administration and all teams. Off: only your teams, like a coach.`
          }
          checked={!coachMode}
          onChange={async (admin) => {
            await api.put("/profile/admin-mode", { coachMode: !admin });
            invalidate("/");
            await refresh();
            toast(admin ? t`Admin view on.` : t`You are now working as a coach.`);
            route("/profil", true);
          }}
        />
      </li>
    </ul>
  );
}

export function ProfilePage() {
  useDocumentTitle(t`Profile`);
  const me = useMe();
  const { logout } = useSession();
  const { route } = useLocation();
  const [nameOpen, setNameOpen] = useState(false);
  const roles = roleLabels();
  const children = joinNames(me.children.map((c) => c.firstName));
  return (
    <main class="page">
      <header class="hero hero-avatar">
        <PersonAvatar personId={me.person.id} name={me.person.firstName} size={56} />
        <div class="kicker">
          <Trans>Profile</Trans>
        </div>
        <h1>{personName(me.person)}</h1>
        <div class="hero-sub">
          {[
            ...me.memberships.map((m) => {
              const name = m.name;
              if (!me.groupIds.includes(m.id)) return `${roles[m.role]} ${name}`;
              return m.role === "coach" ? t`In charge of ${name}` : t`Member of ${name}`;
            }),
            ...(me.children.length ? [t`Parent of ${children}`] : []),
            ...(me.isAdmin ? [t`Admin`] : []),
          ].join(" · ") || t`Member`}
        </div>
      </header>
      <div class="content">
        {me.parentsInCharge ? (
          <Notice>
            <Trans>Your parents are linked to your access. They decide what you can do yourself in the app.</Trans>
          </Notice>
        ) : null}

        <AvatarEditor personId={me.person.id} name={personName(me.person)} view="self" />

        {me.adminSwitch ? <AdminModeSwitch coachMode={me.adminSwitch.coachMode} /> : null}

        {me.children.length ? (
          <section class="stack-sm" aria-label={t`My children`}>
            <h2 class="section-title">
              <Trans>My children</Trans>
            </h2>
            <ul class="list">
              {me.children.map((c) => (
                <li>
                  <a class="list-row" href={`/profil/kind/${c.id}`}>
                    <PersonAvatar personId={c.id} name={c.firstName} />
                    <span class="main">
                      <span class="title">{personName(c)}</span>
                      <span class="sub">
                        {c.teams
                          .map((team) => {
                            const teamName = team.name;
                            return team.parentsEnabled ? teamName : t`${teamName} (without parents)`;
                          })
                          .join(", ") || t`not in a team`}
                        {" · "}
                        {c.parentsInCharge ? t`Profile picture, permissions and notifications` : t`Profile picture`}
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
                <span class="title">
                  <Trans>Passkeys and devices</Trans>
                </span>
                <span class="sub">
                  <Trans>Sign-in by passkey or e-mail, devices</Trans>
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
          <li>
            <button type="button" class="list-row" onClick={() => setNameOpen(true)}>
              <Icon name="edit" size={22} />
              <span class="main">
                <span class="title">
                  <Trans>Change name</Trans>
                </span>
              </span>
            </button>
          </li>
          {!me.isAdmin && me.manageableTeams.length ? (
            <li>
              <a class="list-row" href="/hilfe">
                <Icon name="info" size={22} />
                <span class="main">
                  <span class="title">
                    <Trans>Help and feedback</Trans>
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          ) : null}
          <li>
            <a class="list-row" href="/datenschutz">
              <Icon name="shield" size={22} />
              <span class="main">
                <span class="title">
                  <Trans>Privacy and sources</Trans>
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        </ul>
        <section class="card card-pad" aria-label={t`Language`}>
          <LanguageSwitch />
        </section>
        <InstallHint />
        <Button
          variant="ghost"
          icon="logout"
          onClick={async () => {
            if (!(await confirmDialog({ title: t`Sign out?`, message: t`You can sign in again with your passkey at any time.`, confirmLabel: t`Sign out` }))) return;
            await logout();
            // After the next sign-in, things start with the events
            route("/", true);
          }}
        >
          <Trans>Sign out</Trans>
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

/** Parents set up their child's access, or create a link for a new passkey after a phone change. */
function ChildAccessCard({ child, hasAccount }: { child: PersonRef; hasAccount: boolean }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const firstName = child.firstName;
  const label = hasAccount ? t`Link for a new passkey` : t`Set up access for ${firstName}`;
  return (
    <section class="card card-body stack-sm" aria-label={t`Child's access`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Access for {firstName}</Trans>
      </h2>
      <p class="small muted">
        {hasAccount
          ? t`New phone? With this link ${firstName} sets up a new passkey. The previous one stays valid.`
          : t`${firstName} gets their own access with a passkey. Only give the link to ${firstName} or open it directly on their phone.`}
      </p>
      {link ? (
        <>
          <div class="url-box">{link.url}</div>
          <div class="btn-row">
            <Button icon="copy" onClick={() => copyText(link.url, t`Link copied.`)}>
              <Trans>Copy</Trans>
            </Button>
            <Button
              icon="share"
              onClick={() => {
                const club = clubName();
                void shareLink(t`Access for ${firstName}`, t`Your access to the ${club} app`, link.url);
              }}
            >
              <Trans>Share</Trans>
            </Button>
          </div>
          <div class="qr" role="img" aria-label={t`QR code of the link`} dangerouslySetInnerHTML={{ __html: renderSVG(link.url, { border: 1 }) }} />
          <p class="small muted">
            <Trans>Valid for 7 days, can be used once.</Trans>
          </p>
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
  useDocumentTitle(child ? child.firstName : t`Child`);
  const { data, error, reload, mutate } = useQuery<PermissionsResponse>(child ? `/children/${id}/permissions` : null);
  if (!child) {
    return (
      <main class="page">
        <TopBar title={t`Child`} back="/profil" />
        <div class="content">
          <Notice kind="warn">
            <Trans>This child is not linked to your access.</Trans>
          </Notice>
        </div>
      </main>
    );
  }
  const firstName = child.firstName;
  const permissionLabels = childPermissionLabels();
  const guardians = (data?.guardians ?? [])
    .map((g) => {
      const name = personName(g);
      return g.hasAccount ? name : t`${name} (no access)`;
    })
    .join(", ");
  return (
    <main class="page">
      <TopBar title={personName(child)} kicker={t`Profile picture and permissions`} back="/profil" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        <AvatarEditor personId={child.id} name={personName(child)} view="guardian" />
        {!data ? <Spinner /> : null}
        {data && !data.parentsInCharge ? (
          <Notice>
            <Trans>
              No parents are involved in the teams of {firstName}. {firstName} accepts and declines on their own and is alone in the chat. So there are no
              permissions or notifications for {firstName}.
            </Trans>
          </Notice>
        ) : null}
        {data?.parentsInCharge ? (
          <>
            <Notice>
              {data.childHasAccount
                ? t`${firstName} has their own access. Here you decide what ${firstName} may do on their own. You can always accept and decline for ${firstName}.`
                : t`${firstName} has no access of their own yet. The permissions apply as soon as ${firstName} gets one.`}
            </Notice>
            <ChildAccessCard child={child} hasAccount={data.childHasAccount} />
            <ul class="list" aria-label={t`Permissions`}>
              {(Object.keys(permissionLabels) as ChildPermission[]).map((perm) => (
                <li>
                  <SwitchRow
                    label={permissionLabels[perm]}
                    checked={data.permissions[perm]}
                    onChange={async (value) => {
                      const res = await api.put<{ permissions: ChildPermissions }>(`/children/${id}/permissions`, { permission: perm, value });
                      mutate({ ...data, permissions: res.permissions });
                      toast(t`Saved. The other parent will be notified.`);
                      void reload();
                    }}
                  />
                </li>
              ))}
            </ul>
            <p class="small muted">
              <Trans>Linked parents: {guardians}. Each parent can change the permissions.</Trans>
            </p>
            {data.log.length ? (
              <section class="stack-sm" aria-label={t`Changes`}>
                <h2 class="section-title">
                  <Trans>Recent changes</Trans>
                </h2>
                <ul class="list">
                  {data.log.map((l) => (
                    <li class="list-row">
                      <span class="main">
                        <span>
                          {permissionLabels[l.permission]}: <strong>{l.value ? t`allowed` : t`off`}</strong>
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
              <Trans>Notifications for {firstName}</Trans>
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
  useDocumentTitle(t`Notifications`);
  const me = useMe();
  const { data, error, reload, mutate } = useQuery<NotificationSettings>("/me/notifications");
  const topicLabels = notificationTopicLabels();
  return (
    <main class="page">
      <TopBar title={t`Notifications`} kicker={t`Settings`} back="/profil" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data ? <Spinner /> : null}
        {data?.persons.map((p) => {
          const firstName = p.person.firstName;
          const heading = p.self ? t`For me` : t`For ${firstName}`;
          return (
          <section class="stack-sm" aria-label={heading}>
            <h2 class="section-title">{heading}</h2>
            <ul class="list">
              {(Object.keys(p.topics) as NotificationTopic[]).map((topic) => (
                <li>
                  <SwitchRow
                    label={topicLabels[topic]}
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
          );
        })}
        {me.helperTeams.length || me.referee ? <HelperPrefs /> : null}
        <p class="small muted">
          <Trans>The settings apply to all your devices. Whether a device gets notifications at all is set in your profile.</Trans>
        </p>
      </div>
    </main>
  );
}

type DutyTopic = "duty_remind_3d" | "duty_remind_1d" | "duty_open" | "duty_coach_open" | "duty_referee_open";
const dutyTopicLabels = (): Record<DutyTopic, string> => ({
  duty_remind_3d: t`Reminder 3 days before my duty`,
  duty_remind_1d: t`Reminder 1 day before`,
  duty_open: t`Helpers needed in my teams`,
  duty_coach_open: t`Open slots (coaches and admins)`,
  duty_referee_open: t`Youth referee needed`,
});

interface DutyPrefs {
  skills: { dutyTypeId: number; code: string | null; name: string; on: boolean }[];
  channels: Record<DutyTopic, { push: boolean; mail: boolean; sms: boolean }>;
  mailAddressVerified: boolean;
  smsAvailable?: boolean;
}

/** Helper plan "I can do this": the helper plan only offers duties that need prior knowledge after consent. */
function SkillSwitches() {
  const { data, mutate } = useQuery<DutyPrefs>("/profile/duty-prefs");
  if (!data?.skills.length) return null;
  // Timekeeper and scorer are the same qualification: one switch, internally two consents
  const table = data.skills.filter((sk) => ["timekeeper", "scorer", "zeitnehmer", "sekretaer"].includes(sk.code ?? ""));
  const rows = [
    ...(table.length ? [{ label: joinNames(table.map((sk) => sk.name)), items: table }] : []),
    ...data.skills.filter((sk) => !table.includes(sk)).map((sk) => ({ label: sk.name, items: [sk] })),
  ];
  return (
    <section class="stack-sm" aria-label={t`I can do this`}>
      <h2 class="section-title">
        <Trans>I can do this</Trans>
      </h2>
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
      <p class="small muted">
        <Trans>These duties need prior knowledge. The helper plan only offers them to you if you turn them on here.</Trans>
      </p>
    </section>
  );
}

/** Helper plan: push and/or mail per notification. */
function HelperPrefs() {
  const me = useMe();
  const { data, mutate } = useQuery<DutyPrefs>("/profile/duty-prefs");
  if (!data) return <Spinner />;
  const showCoach = me.isAdmin || me.manageableTeams.length > 0;
  const labels = dutyTopicLabels();
  const topics = (Object.keys(labels) as DutyTopic[]).filter(
    (topic) => (topic !== "duty_coach_open" || showCoach) && (topic !== "duty_referee_open" || me.referee) && (topic !== "duty_open" || me.helperTeams.length > 0),
  );
  const setChannel = async (topic: DutyTopic, ch: { push: boolean; mail: boolean; sms: boolean }) => {
    await api.put("/profile/duty-prefs", { channels: { [topic]: ch } });
    mutate({ ...data, channels: { ...data.channels, [topic]: ch } });
  };
  return (
    <section class="stack-sm" aria-label={t`Helper plan`}>
      <h2 class="section-title">
        <Trans>Helper plan</Trans>
      </h2>
      <div class="duty-channels" role="table" aria-label={t`Notifications in the helper plan`}>
        <div role="row" class="head">
          <span role="columnheader">
            <Trans>Notification</Trans>
          </span>
          <span role="columnheader">
            <Trans>Push</Trans>
          </span>
          <span role="columnheader">
            <Trans>Mail</Trans>
          </span>
          {data.smsAvailable ? (
            <span role="columnheader">
              <Trans>SMS</Trans>
            </span>
          ) : null}
        </div>
        {topics.map((topic) => {
          const label = labels[topic];
          return (
            <div role="row">
              <span role="cell">{label}</span>
              <span role="cell">
                <input
                  type="checkbox"
                  aria-label={t`${label} by push`}
                  checked={data.channels[topic].push}
                  onChange={(e) => setChannel(topic, { ...data.channels[topic], push: (e.target as HTMLInputElement).checked })}
                />
              </span>
              <span role="cell">
                <input
                  type="checkbox"
                  aria-label={t`${label} by mail`}
                  checked={data.channels[topic].mail}
                  onChange={(e) => setChannel(topic, { ...data.channels[topic], mail: (e.target as HTMLInputElement).checked })}
                />
              </span>
              {data.smsAvailable ? (
                <span role="cell">
                  <input
                    type="checkbox"
                    aria-label={t`${label} by SMS`}
                    checked={data.channels[topic].sms}
                    onChange={(e) => setChannel(topic, { ...data.channels[topic], sms: (e.target as HTMLInputElement).checked })}
                  />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {!data.mailAddressVerified ? (
        <p class="small muted">
          <Trans>
            Mails go to the confirmed address you sign in with. You don't have one yet, add it under <a href="/profil/geraete">Profile → Sign-in</a>.
          </Trans>
        </p>
      ) : (
        <p class="small muted">
          <Trans>Mails go to the address you sign in with.</Trans>
        </p>
      )}
    </section>
  );
}

interface Security {
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  passkeys: { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; synced: boolean }[];
  sessions: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; current: boolean }[];
}

/** Address for signing in by e-mail code. Nobody but you sees it. */
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
    <section class="stack-sm" aria-label={t`E-mail for signing in`}>
      <h2 class="section-title">
        <Trans>E-mail for signing in</Trans>
      </h2>
      <div class="card card-pad stack-sm">
        {pending ? (
          <EmailCodeForm
            requestId={pending.requestId}
            email={pending.email}
            onDone={async () => {
              setPending(null);
              toast(t`E-mail address confirmed.`);
              await props.reload();
            }}
            onResend={() => save(pending.email)}
          />
        ) : editing ? (
          <>
            <TextField label={t`E-mail address`} type="email" value={value} onInput={setValue} autoComplete="email" inputMode="email" maxLength={254} />
            <div class="btn-row">
              <Button variant="primary" disabled={!isEmail(value)} onClick={() => save(value.trim().toLowerCase())}>
                <Trans>Send code</Trans>
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </>
        ) : (
          <>
            {data.email ? (
              <p>
                <strong>{data.email}</strong>
                <br />
                <span class="small muted">{data.emailVerified ? t`Confirmed. You can use it to sign in with a code.` : t`Not confirmed yet.`}</span>
              </p>
            ) : (
              <p class="muted">
                <Trans>No address on file yet. With a confirmed address you can get back into the app with a code if your passkey is missing.</Trans>
              </p>
            )}
            <div class="btn-row">
              <Button
                onClick={() => {
                  setValue(data.email ?? "");
                  setEditing(true);
                }}
              >
                {data.email ? t`Change` : t`Add address`}
              </Button>
              {data.email && !data.emailVerified ? (
                <Button onClick={() => save(data.email!)}>
                  <Trans>Send code</Trans>
                </Button>
              ) : null}
              {data.email && data.passkeys.length ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: t`Remove address?`, message: t`After that you can only sign in with your passkey.`, confirmLabel: t`Remove` }))) return;
                    await api.del("/me/email");
                    await props.reload();
                  }}
                >
                  <Trans>Remove</Trans>
                </Button>
              ) : null}
            </div>
          </>
        )}
        <p class="small muted">
          <Trans>Only for signing in. Neither coaches nor admins see the address.</Trans>
        </p>
      </div>
    </section>
  );
}

/** Mobile number for codes and reminders by SMS (SMS module). Nobody but you sees it. */
function PhoneSection(props: { data: Security; reload: () => Promise<unknown> }) {
  const { data } = props;
  const [value, setValue] = useState(data.phone ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<{ requestId: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (phone: string) => {
    setError(null);
    try {
      const res = await api.put<{ verified: boolean; requestId?: string }>("/me/phone", { phone });
      await props.reload();
      if (res.requestId) setPending({ requestId: res.requestId, phone });
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section class="stack-sm" aria-label={t`Mobile number`}>
      <h2 class="section-title">
        <Trans>Mobile number</Trans>
      </h2>
      <div class="card card-pad stack-sm">
        {pending ? (
          <EmailCodeForm
            channel="sms"
            requestId={pending.requestId}
            email={pending.phone}
            onDone={async () => {
              setPending(null);
              toast(t`Mobile number confirmed.`);
              await props.reload();
            }}
            onResend={() => save(pending.phone)}
          />
        ) : editing ? (
          <>
            <TextField label={t`Mobile number`} type="tel" value={value} onInput={setValue} autoComplete="tel" inputMode="text" maxLength={30} placeholder="+49 151 23456789" />
            {error ? <Notice kind="warn">{error}</Notice> : null}
            <div class="btn-row">
              <Button variant="primary" disabled={value.trim().length < 6} onClick={() => save(value.trim())}>
                <Trans>Send code</Trans>
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </>
        ) : (
          <>
            {data.phone ? (
              <p>
                <strong>{data.phone}</strong>
                <br />
                <span class="small muted">{data.phoneVerified ? t`Confirmed. You can sign in with a code by SMS.` : t`Not confirmed yet.`}</span>
              </p>
            ) : (
              <p class="muted">
                <Trans>Optional: with a confirmed mobile number you can sign in with a code by SMS and get helper plan reminders by SMS.</Trans>
              </p>
            )}
            <div class="btn-row">
              <Button
                onClick={() => {
                  setValue(data.phone ?? "");
                  setEditing(true);
                }}
              >
                {data.phone ? t`Change` : t`Add number`}
              </Button>
              {data.phone ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await api.del("/me/phone");
                    await props.reload();
                  }}
                >
                  <Trans>Remove</Trans>
                </Button>
              ) : null}
            </div>
          </>
        )}
        <p class="small muted">
          <Trans>Only for codes and reminders you choose. Neither coaches nor admins see the number.</Trans>
        </p>
      </div>
    </section>
  );
}

export function DevicesPage() {
  useDocumentTitle(t`Passkeys and devices`);
  const smsOn = useModule("sms");
  const { data, error, reload } = useQuery<Security>("/me/security");
  return (
    <main class="page">
      <TopBar title={t`Passkeys and devices`} kicker={t`Security`} back="/profil" />
      <div class="content">
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data ? <Spinner /> : null}
        {data ? (
          <>
            {!data.passkeys.length ? (
              <Notice icon="key">
                <Trans>
                  <strong>Set up a passkey.</strong> It is the safest way to sign in: Face ID, fingerprint or screen lock, without a password and without a code
                  by e-mail.
                </Trans>
              </Notice>
            ) : null}
            <EmailSection data={data} reload={reload} />
            {smsOn ? <PhoneSection data={data} reload={reload} /> : null}
            <section class="stack-sm" aria-label={t`Passkeys`}>
              <h2 class="section-title">
                <Trans>Passkeys</Trans>
              </h2>
              <ul class="list">
                {data.passkeys.map((p) => {
                  const created = stamp(p.createdAt);
                  const lastUsed = p.lastUsedAt ? stamp(p.lastUsedAt) : null;
                  return (
                  <li class="list-row">
                    <Icon name="key" size={22} />
                    <span class="main">
                      <span class="title">{p.label ?? t`Passkey`}</span>
                      <span class="sub">
                        <Trans>Since {created}</Trans>
                        {lastUsed ? ` · ${t`last used ${lastUsed}`}` : ""}
                        {p.synced ? ` · ${t`synced`}` : ""}
                      </span>
                    </span>
                    {data.passkeys.length > 1 || data.emailVerified ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t`Remove passkey`}
                        onClick={async () => {
                          if (!(await confirmDialog({ title: t`Remove passkey?`, message: t`You will no longer be able to sign in with this passkey.`, confirmLabel: t`Remove`, danger: true }))) return;
                          await api.del(`/me/passkeys/${encodeURIComponent(p.id)}`);
                          await reload();
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </Button>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
              <Button
                icon="plus"
                onClick={async () => {
                  try {
                    await registerPasskey("/me/passkeys", {});
                    toast(t`Additional passkey set up.`);
                    await reload();
                  } catch (err) {
                    toast(errorMessage(err), "error");
                  }
                }}
              >
                {data.passkeys.length ? t`Add another passkey` : t`Set up passkey`}
              </Button>
              <p class="small muted">
                <Trans>Tip: a second passkey, e.g. on a tablet, helps if you lose your phone.</Trans>
              </p>
            </section>
            <section class="stack-sm" aria-label={t`Signed-in devices`}>
              <h2 class="section-title">
                <Trans>Signed in on</Trans>
              </h2>
              <ul class="list">
                {data.sessions.map((s) => {
                  const since = stamp(s.createdAt);
                  return (
                  <li class="list-row">
                    <Icon name="phone" size={22} />
                    <span class="main">
                      <span class="title">
                        {s.deviceLabel}{" "}
                        {s.current ? (
                          <span class="badge">
                            <Trans>This device</Trans>
                          </span>
                        ) : null}
                      </span>
                      <span class="sub">
                        <Trans>Signed in since {since}</Trans>
                      </span>
                    </span>
                    {!s.current ? (
                      <Button
                        size="sm"
                        onClick={async () => {
                          await api.del(`/me/sessions/${s.id}`);
                          toast(t`Device signed out.`);
                          await reload();
                          invalidate("/me/security");
                        }}
                      >
                        <Trans>Sign out</Trans>
                      </Button>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
