import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { LocationRef, PersonRef } from "../../shared/types";
import { api } from "../api";
import { moduleOn } from "../../shared/club";
import { clubName, useClub } from "../club";
import { daysBetween, fullDate, isoToLocalDate, personName, todayLocal } from "../format";
import { downloadExport } from "../export";
import { ExtraEventList } from "../extra-events";
import { AdminAvatar, PersonAvatar } from "../avatar";
import { Icon, type IconName } from "../icons";
import { useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, copyText, Empty, ErrorBox, Field, Notice, Segmented, Sheet, shareLink, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { QrLink } from "./team";
import { roleLabel } from "./group";

export function AdminOnly({ children }: { children: preact.ComponentChildren }) {
  const me = useMe();
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title={t`Administration`} back="/" />
        <div class="content">
          <Notice kind="warn">
            <Trans>This area is for admins only.</Trans>
          </Notice>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

export function AdminPage() {
  useDocumentTitle(t`Administration`);
  const me = useMe();
  const club = useClub();
  const teamsQuery = useQuery<{ teams: { id: number; name: string; kind: "team" | "group"; players: number; coaches: number }[] }>("/teams");
  const teams = { ...teamsQuery, data: teamsQuery.data && { teams: teamsQuery.data.teams.filter((x) => x.kind === "team") } };
  const groupCount = (teamsQuery.data?.teams ?? []).filter((x) => x.kind === "group").length;
  const coaching = new Set(me.memberships.filter((m) => m.role === "coach").map((m) => m.id));
  const own = (teamsQuery.data?.teams ?? []).filter((x) => coaching.has(x.id));
  const teamCount = teams.data?.teams.length ?? 0;
  const firstName = me.person.firstName;
  const items: { href: string; icon: IconName; title: string; sub: string; download?: boolean }[] = [
    {
      href: "/verwaltung/mannschaften",
      icon: "users",
      title: t`Teams`,
      sub: teams.data
        ? `${plural(teamCount, { one: "# team", other: "# teams" })} · ${t`Open squads, create, assign coaches`}`
        : t`Open squads, create, assign coaches`,
    },
    {
      href: "/verwaltung/gruppen",
      icon: "chat",
      title: t`Groups`,
      sub: `${groupCount ? `${plural(groupCount, { one: "# group", other: "# groups" })} · ` : ""}${t`Only chat and special events, e.g. coaching team`}`,
    },
    { href: "/verwaltung/personen", icon: "user", title: t`People`, sub: t`All members, admins, access links` },
    { href: "/verwaltung/altersklassen", icon: "calendar", title: t`Age groups`, sub: t`Birth years of the current season` },
    { href: "/verwaltung/ferien", icon: "sun", title: t`Holidays`, sub: t`Edit periods (e.g. carnival)` },
    { href: "/verwaltung/orte", icon: "pin", title: t`Training venues`, sub: t`Club halls and other venues` },
    { href: "/verwaltung/rundnachricht", icon: "bell", title: t`Broadcast`, sub: t`Announcement in all or selected team chats` },
    ...(moduleOn(club.modules, "duties")
      ? [{ href: "/verwaltung/helferdienste", icon: "helping" as IconName, title: t`Helper duties`, sub: t`Duty types and templates for games and special events` }]
      : []),
    ...(moduleOn(club.modules, "youthReferees")
      ? [{ href: "/verwaltung/kihasl", icon: "whistle" as IconName, title: "KiHaSL/JuHaSL", sub: t`Grant the referee role by link, list` }]
      : []),
    { href: "/chat?alle", icon: "chat", title: t`All chats`, sub: t`Team chats in which you are not a coach or parent` },
    { href: "/verwaltung/sondertermine", icon: "calendar", title: t`Special events and games`, sub: t`Upcoming events of other teams, create a special event` },
    { href: "/verwaltung/verein", icon: "settings", title: t`Club`, sub: t`Name, colours, logo, region, modules` },
    { href: "/verwaltung/mail", icon: "mail", title: t`E-mail`, sub: t`How the app sends e-mails` },
    { href: "/verwaltung/saisonwechsel", icon: "refresh", title: t`Season change`, sub: t`Once a year, with preview` },
    { href: "/api/admin/export", icon: "download", title: t`Export`, sub: t`All data as a JSON file, for backup`, download: true },
    { href: "/hilfe", icon: "info", title: t`Help and feedback`, sub: t`Send feedback about the app` },
  ];
  return (
    <AdminOnly>
      <main class="page">
        <header class="hero">
          <div class="kicker">
            <Trans>Administration</Trans>
          </div>
          <h1>{club.name}</h1>
          <div class="hero-sub">
            <Trans>Signed in as admin {firstName}</Trans>
          </div>
        </header>
        <div class="content">
          {/* Only own teams as a shortcut, all others under Administration → Teams */}
          {own.length ? (
            <section class="stack-sm" aria-label={t`My teams`}>
              <h2 class="section-title">
                <Trans>My teams</Trans>
              </h2>
              <ul class="list">
                {own.map((team) => (
                  <li>
                    <a class="list-row" href={`/team/${team.id}`}>
                      <span class="team-badge" style={{ minWidth: "48px", textAlign: "center" }}>
                        {team.name}
                      </span>
                      <span class="main">
                        <span class="sub">{memberCounts(team.players, team.coaches)}</span>
                      </span>
                      <Icon name="chevron" size={18} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {teams.error ? <ErrorBox error={teams.error} /> : null}
          <ul class="list" aria-label={t`Administration`}>
            {items.map((i) => (
              <li>
                {i.download ? (
                  // Button instead of link: the router would intercept the link, the privacy notice comes first
                  <button type="button" class="list-row" onClick={() => void downloadExport()}>
                    <Icon name={i.icon} size={22} />
                    <span class="main">
                      <span class="title">{i.title}</span>
                      <span class="sub">{i.sub}</span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                ) : (
                  <a class="list-row" href={i.href}>
                    <Icon name={i.icon} size={22} />
                    <span class="main">
                      <span class="title">{i.title}</span>
                      <span class="sub">{i.sub}</span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </AdminOnly>
  );
}

/** "12 players · 2 coaches" */
function memberCounts(players: number, coaches: number): string {
  return `${plural(players, { one: "# player", other: "# players" })} · ${plural(coaches, { one: "# coach", other: "# coaches" })}`;
}

// Broadcast ---------------------------------------------------------------------------

export function AdminBroadcastPage() {
  useDocumentTitle(t`Broadcast`);
  const teams = useQuery<{ teams: { id: number; name: string; players: number }[] }>("/teams");
  const [text, setText] = useState("");
  const [all, setAll] = useState(true);
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = teams.data?.teams ?? [];
  const count = all ? list.length : teamIds.length;
  const chatCount = list.length;
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Broadcast`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <p class="muted">
            <Trans>Appears as a highlighted announcement in the chat of every selected team, with your name.</Trans>
          </p>
          <Field label={t`Message`}>
            {(fid) => (
              <textarea
                id={fid}
                class="textarea"
                rows={5}
                value={text}
                maxLength={2000}
                onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
                placeholder={t`e.g. invitation to the end-of-season party on …`}
              />
            )}
          </Field>
          <ul class="list">
            <li>
              <SwitchRow
                label={t`To all teams`}
                sub={plural(chatCount, { one: "# team chat", other: "# team chats" })}
                checked={all}
                onChange={setAll}
              />
            </li>
          </ul>
          {!all ? (
            <div class="field" role="group" aria-label={t`Teams`}>
              <span class="field-label">
                <Trans>Teams</Trans>
              </span>
              <span class="field-hint">
                <Trans>Several possible</Trans>
              </span>
              <div class="chips">
                {list.map((team) => (
                  <button
                    type="button"
                    class={`chip ${teamIds.includes(team.id) ? "selected" : ""}`}
                    aria-pressed={teamIds.includes(team.id) ? "true" : "false"}
                    onClick={() => setTeamIds(teamIds.includes(team.id) ? teamIds.filter((x) => x !== team.id) : [...teamIds, team.id])}
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <ul class="list">
            <li>
              <SwitchRow
                label={t`Notify everyone immediately`}
                sub={
                  notify
                    ? t`Everyone in the chat, including parents, gets a notification immediately and the number on the app icon goes up (as with @alle).`
                    : t`Like a normal chat message: a bundled chat notification for everyone who has turned it on.`
                }
                checked={notify}
                onChange={setNotify}
              />
            </li>
          </ul>
          <Button
            variant="primary"
            size="lg"
            icon="send"
            disabled={busy || !text.trim() || !count}
            onClick={async () => {
              const ok = await confirmDialog({
                title: t`Send broadcast?`,
                message: notify
                  ? plural(count, {
                      one: "The announcement appears in one team chat and everyone is notified immediately.",
                      other: "The announcement appears in # team chats and everyone is notified immediately.",
                    })
                  : plural(count, { one: "The announcement appears in one team chat.", other: "The announcement appears in # team chats." }),
                confirmLabel: t`Send`,
              });
              if (!ok) return;
              setBusy(true);
              try {
                const res = await api.post<{ sent: number }>("/admin/broadcast", { teamIds: all ? [] : teamIds, text: text.trim(), notify });
                const sent = res.sent;
                toast(plural(sent, { one: "Sent to one chat.", other: "Sent to # chats." }));
                setText("");
                invalidate("/chat/rooms");
              } finally {
                setBusy(false);
              }
            }}
          >
            {count ? plural(count, { one: "Send to one chat", other: "Send to # chats" }) : t`Choose teams`}
          </Button>
        </div>
      </main>
    </AdminOnly>
  );
}

// Teams -------------------------------------------------------------------------------

interface AgeClass {
  code: string;
  name: string;
  rank: number;
  isYouth: boolean;
  birthYearMin: number | null;
  birthYearMax: number | null;
  /** How long a game blocks the hall (helper duty blocks, "in progress" card). */
  gameMinutes: number;
  /** Home games need a youth referee (handball: KiHaSL/JuHaSL). */
  youthReferee: boolean;
}

type TeamGender = "f" | "m" | "x";

interface AdminPerson {
  person: PersonRef;
  birthYear: number | null;
  isActive: boolean;
  isAdmin: boolean;
  adminEmail: string | null;
  hasAccount: boolean;
  isReferee: boolean;
  isClubMember: boolean;
  /** Last activity of the account (local date), null = never used or no account. */
  lastSeenOn: string | null;
  teams: { name: string; role: string; isGroup: boolean }[];
  children: string | null;
  /** Teams of the children (parents). */
  childTeams: string[];
  childIds: number[];
  parentIds: number[];
}

type RoleFilter = "all" | "player" | "coach" | "parent" | "none";
type ActivityFilter = "" | "stale" | "never" | "noaccount";
type SortOrder = "name" | "activity";

/** After this many days without activity an account counts as abandoned in the filter. */
const STALE_DAYS = 60;

function daysSinceSeen(p: AdminPerson): number | null {
  return p.lastSeenOn ? daysBetween(p.lastSeenOn, todayLocal()) : null;
}

/** "active today", "active 12 days ago", "access never used", "no access" */
export function activityLabel(p: Pick<AdminPerson, "hasAccount" | "lastSeenOn">): string {
  if (!p.hasAccount) return t`no access`;
  if (!p.lastSeenOn) return t`Access never used`;
  const days = daysBetween(p.lastSeenOn, todayLocal());
  if (days <= 0) return t`active today`;
  if (days === 1) return t`active yesterday`;
  if (days < 45) return t`active ${days} days ago`;
  const months = Math.round(days / 30);
  if (days < 365) return t`active ${months} months ago`;
  return t`active over a year ago`;
}

/** Like activityLabel without "active", for "Last active: <date> (<ago>)". */
function lastSeenAgo(lastSeenOn: string): string {
  const days = daysBetween(lastSeenOn, todayLocal());
  if (days <= 0) return t`today`;
  if (days === 1) return t`yesterday`;
  if (days < 45) return t`${days} days ago`;
  const months = Math.round(days / 30);
  if (days < 365) return t`${months} months ago`;
  return t`over a year ago`;
}

/** Sort order "Last active": never-used accounts, then longest inactive, people without an account at the end. */
function activityRank(p: AdminPerson): number {
  if (!p.hasAccount) return -1;
  const days = daysSinceSeen(p);
  return days == null ? Number.MAX_SAFE_INTEGER : days;
}

/** Neither team nor child nor admin or KiHaSL role: candidates for cleaning up. */
function withoutRole(p: AdminPerson): boolean {
  return !p.teams.length && !p.childIds.length && !p.isAdmin && !p.isReferee;
}
const NONE = "__none__";

export function AdminTeamsPage() {
  useDocumentTitle(t`Teams`);
  const { refresh } = useSession();
  const teams = useQuery<{
    teams: { id: number; name: string; kind: "team" | "group"; ageClassCode: string; gender: TeamGender; level: number; parentsEnabled: boolean; players: number; coaches: number }[];
  }>("/teams");
  const ages = useQuery<{ ageClasses: AgeClass[] }>("/age-classes");
  const [edit, setEdit] = useState<{
    id?: number;
    name: string;
    ageClassCode: string;
    gender: TeamGender;
    level: number;
    parentsEnabled: boolean;
    wasEnabled?: boolean;
  } | null>(null);
  const genderLabel = (g: TeamGender) => (g === "f" ? t`female` : g === "m" ? t`male` : t`mixed`);
  const isYouth = (code: string) => ages.data?.ageClasses.find((a) => a.code === code)?.isYouth ?? true;
  const [coachesFor, setCoachesFor] = useState<{ id: number; name: string } | null>(null);

  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Teams`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              const code = ages.data?.ageClasses[0]?.code ?? "";
              setEdit({ name: "", ageClassCode: code, gender: "x", level: 1, parentsEnabled: isYouth(code) });
            }}
          >
            <Trans>Create team</Trans>
          </Button>
          {teams.error ? <ErrorBox error={teams.error} /> : null}
          <p class="small muted">
            <Trans>
              For circles without training and games, such as the coaching team, there are <a href="/verwaltung/gruppen">groups</a>.
            </Trans>
          </p>
          <ul class="list">
            {(teams.data?.teams ?? []).filter((x) => x.kind === "team").map((team) => {
              const level = team.level;
              return (
                <li>
                  <div class="list-row">
                    <span class="team-badge" style={{ minWidth: "48px", textAlign: "center" }}>
                      {team.name}
                    </span>
                    <span class="main">
                      <span class="title">
                        {ages.data?.ageClasses.find((a) => a.code === team.ageClassCode)?.name ?? team.ageClassCode} · {genderLabel(team.gender)}
                      </span>
                      <span class="sub">
                        {t`Team ${level}`} · {memberCounts(team.players, team.coaches)}
                        {team.parentsEnabled ? "" : ` · ${t`without parents`}`}
                      </span>
                    </span>
                  </div>
                  <div class="btn-row" style={{ padding: "0 14px 12px" }}>
                    <a class="btn btn-sm" href={`/team/${team.id}`}>
                      <Trans>Open</Trans>
                    </a>
                    <Button size="sm" onClick={() => setCoachesFor({ id: team.id, name: team.name })}>
                      <Trans context="short">Coaches</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEdit({
                          id: team.id,
                          name: team.name,
                          ageClassCode: team.ageClassCode,
                          gender: team.gender,
                          level: team.level,
                          parentsEnabled: team.parentsEnabled,
                          wasEnabled: team.parentsEnabled,
                        })
                      }
                    >
                      <Trans>Edit</Trans>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {edit ? (
          <Sheet open onClose={() => setEdit(null)} title={edit.id ? t`Edit team` : t`New team`}>
            <TextField label={t`Name`} value={edit.name} onInput={(v) => setEdit({ ...edit, name: v })} maxLength={30} hint={t`e.g. wC1, wC2, Damen 2`} />
            <Field label={t`Age group`}>
              {(id) => (
                <select
                  id={id}
                  class="select"
                  value={edit.ageClassCode}
                  onChange={(e) => {
                    const code = (e.target as HTMLSelectElement).value;
                    // New teams: youth with parents, adults without
                    setEdit({ ...edit, ageClassCode: code, parentsEnabled: edit.id ? edit.parentsEnabled : isYouth(code) });
                  }}
                >
                  {(ages.data?.ageClasses ?? []).map((a) => (
                    <option value={a.code}>
                      {a.name} ({a.code})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t`Gender`}>
              {(id) => (
                <select id={id} class="select" value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: (e.target as HTMLSelectElement).value as TeamGender })}>
                  {(["f", "m", "x"] as const).map((g) => (
                    <option value={g}>{genderLabel(g)}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t`Team number`}>
              {(id) => (
                <select id={id} class="select" value={edit.level} onChange={(e) => setEdit({ ...edit, level: Number((e.target as HTMLSelectElement).value) })}>
                  {[1, 2, 3, 4].map((level) => (
                    <option value={level}>{t`Team ${level}`}</option>
                  ))}
                </select>
              )}
            </Field>
            <SwitchRow
              label={t`Include parents`}
              sub={t`Parents respond for their child, are in the chat and get notifications. Turn off when the players take responsibility themselves, for example in older youth teams and for adults.`}
              checked={edit.parentsEnabled}
              onChange={(v) => setEdit({ ...edit, parentsEnabled: v })}
            />
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!edit.name.trim() || !edit.ageClassCode}
              onClick={async () => {
                const body = { name: edit.name.trim(), ageClassCode: edit.ageClassCode, gender: edit.gender, level: edit.level, parentsEnabled: edit.parentsEnabled };
                if (edit.id && edit.wasEnabled && !edit.parentsEnabled) {
                  const ok = await confirmDialog({
                    title: t`Continue without parents?`,
                    message: t`Parents will then no longer see this team's events and chat and can no longer respond for their child. Open parent links become invalid. The links between parents and children are kept and apply again if you turn parents on later.`,
                    confirmLabel: t`Without parents`,
                  });
                  if (!ok) return;
                }
                if (edit.id) await api.patch(`/teams/${edit.id}`, body);
                else await api.post("/teams", body);
                toast(t`Saved.`);
                setEdit(null);
                invalidate("/teams");
                await refresh();
              }}
            >
              <Trans>Save</Trans>
            </Button>
            {edit.id ? (
              <Button
                variant="ghost"
                icon="trash"
                onClick={async () => {
                  if (!(await confirmDialog({ title: t`Delete team?`, message: t`Only possible when nobody is assigned any more.`, confirmLabel: t`Delete`, danger: true })))
                    return;
                  await api.del(`/teams/${edit.id}`);
                  setEdit(null);
                  invalidate("/teams");
                  await refresh();
                }}
              >
                <Trans>Delete team</Trans>
              </Button>
            ) : null}
          </Sheet>
        ) : null}
        {coachesFor ? <CoachesSheet team={coachesFor} onClose={() => setCoachesFor(null)} /> : null}
      </main>
    </AdminOnly>
  );
}

function CoachesSheet({ team, onClose }: { team: { id: number; name: string }; onClose: () => void }) {
  const { refresh } = useSession();
  const persons = useQuery<{ persons: AdminPerson[] }>("/admin/persons");
  const [filter, setFilter] = useState("");
  const coaches = (persons.data?.persons ?? []).filter((p) => p.teams.some((m) => m.name === team.name && m.role === "coach"));
  const candidates = (persons.data?.persons ?? []).filter(
    (p) => !coaches.includes(p) && (!filter || personName(p.person).toLowerCase().includes(filter.toLowerCase())),
  );
  const update = async () => {
    invalidate("/admin/persons", "/teams");
    await persons.reload();
    await refresh();
  };
  const teamName = team.name;
  return (
    <Sheet open onClose={onClose} title={t`Coaches of ${teamName}`}>
      {!persons.data ? <Spinner /> : null}
      <ul class="list">
        {coaches.map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">{c.hasAccount ? t`has access` : t`no access yet – create a link under People`}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.del(`/teams/${team.id}/members/${c.person.id}?role=coach`);
                await update();
              }}
            >
              <Trans>Remove</Trans>
            </Button>
          </li>
        ))}
      </ul>
      {!coaches.length && persons.data ? (
        <p class="muted">
          <Trans>No coach assigned yet.</Trans>
        </p>
      ) : null}
      <TextField label={t`Search person`} value={filter} onInput={setFilter} placeholder={t`Name`} />
      <ul class="list" style={{ maxHeight: "40vh", overflowY: "auto" }}>
        {candidates.slice(0, 30).map((p) => {
          const children = p.children;
          return (
            <li class="list-row">
              <span class="main">
                <span class="title">{personName(p.person)}</span>
                <span class="sub">
                  {p.teams.map((m) => `${m.name} (${roleLabel(m.role, m.isGroup)})`).join(", ") || (children ? t`Parent of ${children}` : t`no team`)}
                </span>
              </span>
              <Button
                size="sm"
                onClick={async () => {
                  await api.post(`/teams/${team.id}/members`, { personId: p.person.id, role: "coach" });
                  const firstName = p.person.firstName;
                  toast(t`${firstName} is now a coach of ${teamName}.`);
                  await update();
                }}
              >
                <Trans>Make coach</Trans>
              </Button>
            </li>
          );
        })}
      </ul>
      <p class="small muted">
        <Trans>Create new coaches under People first.</Trans>
      </p>
    </Sheet>
  );
}

// People ------------------------------------------------------------------------------

export function AdminPersonsPage() {
  useDocumentTitle(t`People`);
  const me = useMe();
  const { data, error, reload } = useQuery<{ persons: AdminPerson[] }>("/admin/persons");
  const [filter, setFilter] = useState("");
  const [team, setTeam] = useState("");
  const [year, setYear] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [activity, setActivity] = useState<ActivityFilter>("");
  const [sort, setSort] = useState<SortOrder>("name");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const persons = data?.persons ?? [];
  const selected = persons.find((p) => p.person.id === selectedId) ?? null;
  const teamNames = useMemo(() => [...new Set(persons.flatMap((p) => p.teams.map((m) => m.name)))].sort((a, b) => a.localeCompare(b, "de")), [data]);
  const years = useMemo(() => [...new Set(persons.map((p) => p.birthYear).filter((y): y is number => y != null))].sort((a, b) => b - a), [data]);
  const list = useMemo(
    () =>
      persons.filter((p) => {
        if (filter && !personName(p.person).toLowerCase().includes(filter.toLowerCase())) return false;
        if (year && (year === NONE ? p.birthYear != null : String(p.birthYear) !== year)) return false;
        // With team: members and parents of members
        const inTeam = (m: { name: string; role: string }) => !team || m.name === team;
        if (team === NONE) {
          if (p.teams.length || p.childTeams.length) return false;
        } else if (team && !p.teams.some(inTeam) && !p.childTeams.includes(team)) return false;
        if (role === "player" && !p.teams.some((m) => inTeam(m) && (m.role === "player" || m.role === "helper"))) return false;
        if (role === "coach" && !p.teams.some((m) => inTeam(m) && m.role === "coach")) return false;
        if (role === "parent" && !(team ? p.childTeams.includes(team) : p.childTeams.length || p.children)) return false;
        if (role === "none" && !withoutRole(p)) return false;
        if (activity === "stale" && !(p.hasAccount && (daysSinceSeen(p) ?? Infinity) > STALE_DAYS)) return false;
        if (activity === "never" && !(p.hasAccount && !p.lastSeenOn)) return false;
        if (activity === "noaccount" && p.hasAccount) return false;
        return true;
      }).sort((a, b) => (sort === "activity" ? activityRank(b) - activityRank(a) : 0)),
    [data, filter, team, year, role, activity, sort],
  );
  const noRoleCount = persons.filter(withoutRole).length;
  const staleDays = STALE_DAYS;
  const shown = list.length;
  const total = persons.length;
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`People`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <div class="row-gap">
            <div style={{ flex: 1 }}>
              <TextField label={t`Search`} value={filter} onInput={setFilter} placeholder={t`Name`} />
            </div>
          </div>
          <div class="row-gap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Field label={t({ message: "Team", context: "filter" })}>
                {(id) => (
                  <select id={id} class="select" value={team} onChange={(e) => setTeam((e.target as HTMLSelectElement).value)}>
                    <option value="">{t`All`}</option>
                    {teamNames.map((n) => (
                      <option value={n}>{n}</option>
                    ))}
                    <option value={NONE}>{t`Without team`}</option>
                  </select>
                )}
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label={t`Year of birth`}>
                {(id) => (
                  <select id={id} class="select" value={year} onChange={(e) => setYear((e.target as HTMLSelectElement).value)}>
                    <option value="">{t`All`}</option>
                    {years.map((y) => (
                      <option value={String(y)}>{y}</option>
                    ))}
                    <option value={NONE}>{t`Not specified`}</option>
                  </select>
                )}
              </Field>
            </div>
          </div>
          <Segmented
            label={t`Role`}
            value={role}
            onChange={setRole}
            options={[
              { value: "all", label: t`All` },
              { value: "player", label: t({ message: "Players", context: "short" }) },
              { value: "coach", label: t({ message: "Coaches", context: "short" }) },
              { value: "parent", label: t`Parents` },
              { value: "none", label: data ? t`No role (${noRoleCount})` : t`No role` },
            ]}
          />
          <div class="row-gap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Field label={t`Activity`}>
                {(id) => (
                  <select id={id} class="select" value={activity} onChange={(e) => setActivity((e.target as HTMLSelectElement).value as ActivityFilter)}>
                    <option value="">{t`All`}</option>
                    <option value="stale">{t`Not active for over ${staleDays} days`}</option>
                    <option value="never">{t`Access never used`}</option>
                    <option value="noaccount">{t`No access`}</option>
                  </select>
                )}
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label={t`Sort by`}>
                {(id) => (
                  <select id={id} class="select" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortOrder)}>
                    <option value="name">{t`Name`}</option>
                    <option value="activity">{t`Last active`}</option>
                  </select>
                )}
              </Field>
            </div>
          </div>
          <Button icon="plus" onClick={() => setCreateOpen(true)}>
            <Trans>Add person</Trans>
          </Button>
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data ? <Spinner /> : null}
          <p class="small muted">
            {shown === total ? plural(total, { one: "# person", other: "# people" }) : t`${shown} of ${total} people`}
            {team || year || role !== "all" || filter || activity ? (
              <>
                {" · "}
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    setFilter("");
                    setTeam("");
                    setYear("");
                    setRole("all");
                    setActivity("");
                  }}
                >
                  <Trans>Reset filters</Trans>
                </button>
              </>
            ) : null}
          </p>
          <ul class="list">
            {list.map((p) => {
              const birthYear = p.birthYear;
              const children = p.children;
              return (
                <li>
                  <button type="button" class="list-row" onClick={() => setSelectedId(p.person.id)}>
                    <PersonAvatar personId={p.person.id} name={p.person.firstName} />
                    <span class="main">
                      <span class="title">
                        {personName(p.person)}{" "}
                        {p.isAdmin ? (
                          <span class="badge">
                            <Trans>Admin</Trans>
                          </span>
                        ) : null}{" "}
                        {!p.isActive ? (
                          <span class="badge muted">
                            <Trans>Inactive</Trans>
                          </span>
                        ) : null}
                      </span>
                      <span class="sub">
                        {[
                          // Without a team the year of birth helps to place the person
                          !p.teams.length && birthYear ? t`b. ${birthYear}` : "",
                          ...p.teams.map((m) => `${m.name} ${m.role === "coach" ? t`(coach)` : m.role === "helper" ? t`(stand-in)` : ""}`.trim()),
                          children ? t`Parent of ${children}` : "",
                          activityLabel(p),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {selected ? (
          <PersonAdminSheet p={selected} all={persons} selfId={me.person.id} onClose={() => setSelectedId(null)} onChanged={reload} />
        ) : null}
        {createOpen ? <CreatePersonSheet onClose={() => setCreateOpen(false)} onDone={reload} /> : null}
      </main>
    </AdminOnly>
  );
}

function CreatePersonSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  return (
    <Sheet open onClose={onClose} title={t`Add person`}>
      <p class="muted">
        <Trans>For example new coaches. Coaches add players in the squad.</Trans>
      </p>
      <TextField label={t`First name`} value={first} onInput={setFirst} maxLength={50} />
      <TextField label={t`Last name`} value={last} onInput={setLast} maxLength={50} />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!first.trim()}
        onClick={async () => {
          await api.post("/admin/persons", { firstName: first.trim(), lastName: last.trim() || null });
          toast(t`Created. Assign the person as a coach under Teams.`);
          onClose();
          onDone();
        }}
      >
        <Trans>Create</Trans>
      </Button>
    </Sheet>
  );
}

/** Assign or remove parents and children of a person (corrections by admins). */
function FamilySection({ p, all, onChanged }: { p: AdminPerson; all: AdminPerson[]; onChanged: () => void }) {
  const [picking, setPicking] = useState<"child" | "parent" | null>(null);
  const [search, setSearch] = useState("");
  const byId = new Map(all.map((x) => [x.person.id, x]));
  const describe = (x: AdminPerson) => {
    const birthYear = x.birthYear;
    return [x.teams.map((m) => m.name).join(", "), birthYear ? t`b. ${birthYear}` : ""].filter(Boolean).join(" · ");
  };

  const link = async (guardianId: number, childId: number) => {
    await api.post("/admin/guardianships", { guardianId, childId });
    setPicking(null);
    setSearch("");
    toast(t`Assigned.`);
    onChanged();
  };
  const unlink = async (guardianId: number, childId: number) => {
    const g = byId.get(guardianId);
    const c = byId.get(childId);
    const parent = g ? personName(g.person) : t`The parent`;
    const child = c ? c.person.firstName : t`the child`;
    const ok = await confirmDialog({
      title: t`Remove link?`,
      message: t`${parent} can then no longer act for ${child}. Both people are kept.`,
      confirmLabel: t`Unlink`,
      danger: true,
    });
    if (!ok) return;
    await api.del(`/admin/guardianships/${guardianId}/${childId}`);
    onChanged();
  };

  const candidates = all
    .filter((x) => x.person.id !== p.person.id && !p.childIds.includes(x.person.id) && !p.parentIds.includes(x.person.id))
    .filter((x) => !search || personName(x.person).toLowerCase().includes(search.toLowerCase()))
    // For children show players first
    .sort((a, b) => (picking === "child" ? Number(b.teams.some((m) => m.role === "player")) - Number(a.teams.some((m) => m.role === "player")) : 0))
    .slice(0, 30);

  const row = (x: AdminPerson | undefined, onRemove: () => void) =>
    x ? (
      <li class="list-row">
        <span class="main">
          <span class="title">{personName(x.person)}</span>
          <span class="sub">{describe(x) || t`no team`}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          <Trans>Unlink</Trans>
        </Button>
      </li>
    ) : null;

  return (
    <section class="stack-sm">
      <strong>
        <Trans>Family</Trans>
      </strong>
      {p.childIds.length ? (
        <>
          <span class="small muted">
            <Trans>Children</Trans>
          </span>
          <ul class="list">{p.childIds.map((id) => row(byId.get(id), () => unlink(p.person.id, id)))}</ul>
        </>
      ) : null}
      {p.parentIds.length ? (
        <>
          <span class="small muted">
            <Trans>Parents</Trans>
          </span>
          <ul class="list">{p.parentIds.map((id) => row(byId.get(id), () => unlink(id, p.person.id)))}</ul>
        </>
      ) : null}
      {picking ? (
        <div class="stack-sm">
          <TextField label={picking === "child" ? t`Search child` : t`Search parent`} value={search} onInput={setSearch} placeholder={t`Name`} />
          <ul class="list">
            {candidates.map((x) => (
              <li>
                <button
                  type="button"
                  class="list-row"
                  onClick={() => (picking === "child" ? link(p.person.id, x.person.id) : link(x.person.id, p.person.id))}
                >
                  <span class="main">
                    <span class="title">{personName(x.person)}</span>
                    <span class="sub">{describe(x) || t`no team`}</span>
                  </span>
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setPicking(null)}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      ) : (
        <div class="btn-row">
          <Button size="sm" icon="plus" onClick={() => setPicking("child")}>
            <Trans>Assign child</Trans>
          </Button>
          <Button size="sm" icon="plus" onClick={() => setPicking("parent")}>
            <Trans>Assign parent</Trans>
          </Button>
        </div>
      )}
      <p class="small muted">
        <Trans>Parents see their children's events, respond for them and are in the team chat, provided the team includes parents.</Trans>
      </p>
    </section>
  );
}

/** Assign a person to teams or remove them (admins). */
function TeamsSection({ p, onChanged }: { p: AdminPerson; onChanged: () => void }) {
  const teams = useQuery<{ teams: { id: number; name: string; kind: "team" | "group"; autoMembers: string | null }[] }>("/teams");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<"player" | "coach">("player");
  const [busy, setBusy] = useState(false);
  const all = teams.data?.teams ?? [];
  const idOf = new Map(all.map((x) => [x.name, x.id]));
  // Groups with automatic members (KiHaSL/JuHaSL) cannot be assigned by hand
  const free = all.filter((x) => !x.autoMembers && !p.teams.some((m) => m.name === x.name && m.role === role));
  const selected = all.find((x) => x.id === Number(teamId || free[0]?.id));
  const selectedIsGroup = selected?.kind === "group";
  const roleName = roleLabel(role, selectedIsGroup);
  const teamRole = roleLabel(role, false);

  const done = () => {
    invalidate("/teams");
    onChanged();
  };
  const add = async () => {
    const id = Number(teamId || free[0]?.id);
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/teams/${id}/members`, { personId: p.person.id, role });
      const firstName = p.person.firstName;
      const teamName = all.find((x) => x.id === id)?.name ?? t`the team`;
      toast(t`${firstName} is now ${roleName} in ${teamName}.`);
      setTeamId("");
      done();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (name: string, r: string, isGroup: boolean) => {
    const id = idOf.get(name);
    if (!id) return;
    const fullName = personName(p.person);
    const memberRole = roleLabel(r, isGroup);
    const ok = await confirmDialog({
      title: t`Remove from ${name}?`,
      message: t`${fullName} will then no longer be ${memberRole} in ${name}. The person is kept.`,
      confirmLabel: t`Remove`,
      danger: true,
    });
    if (!ok) return;
    await api.del(`/teams/${id}/members/${p.person.id}?role=${r}`);
    done();
  };

  return (
    <section class="stack-sm">
      <strong>
        <Trans>Teams and groups</Trans>
      </strong>
      {p.teams.length ? (
        <ul class="list">
          {p.teams.map((m) => (
            <li class="list-row">
              <span class="main">
                <span class="title">{m.name}</span>
                <span class="sub">{m.isGroup ? `${t`Group`} · ${roleLabel(m.role, true)}` : roleLabel(m.role, false)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => remove(m.name, m.role, m.isGroup)}>
                <Trans>Remove</Trans>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted">
          <Trans>Not assigned to any team yet.</Trans>
        </p>
      )}
      {teams.error ? <ErrorBox error={teams.error} /> : null}
      {all.length ? (
        <>
          <Segmented
            label={t`Role`}
            value={role}
            onChange={setRole}
            options={[
              { value: "player", label: t`Player / member` },
              { value: "coach", label: t`Coach / in charge` },
            ]}
          />
          {free.length ? (
            <>
              <Field label={t`Team or group`}>
                {(id) => (
                  <select id={id} class="select" value={teamId || String(free[0]!.id)} onChange={(e) => setTeamId((e.target as HTMLSelectElement).value)}>
                    {free.map((x) => {
                      const name = x.name;
                      return <option value={x.id}>{x.kind === "group" ? t`${name} (group)` : name}</option>;
                    })}
                  </select>
                )}
              </Field>
              <Button icon="plus" disabled={busy} onClick={add}>
                <Trans>Assign as {roleName}</Trans>
              </Button>
            </>
          ) : (
            <p class="small muted">
              <Trans>Already {teamRole} everywhere.</Trans>
            </p>
          )}
        </>
      ) : null}
      <p class="small muted">
        <Trans>Coaches add stand-ins in their own team.</Trans>
      </p>
    </section>
  );
}

/** Correct or complete a person's details (only first name, last name, year of birth). */
function PersonDataSection({ p, onChanged }: { p: AdminPerson; onChanged: () => void }) {
  const [firstName, setFirstName] = useState(p.person.firstName);
  const [lastName, setLastName] = useState(p.person.lastName ?? "");
  const [birthYear, setBirthYear] = useState(p.birthYear ? String(p.birthYear) : "");
  const [busy, setBusy] = useState(false);
  const year = birthYear.trim() ? Number(birthYear.trim()) : null;
  const yearInvalid = year != null && (!Number.isInteger(year) || year < 1930 || year > new Date().getFullYear());
  const changed = firstName.trim() !== p.person.firstName || (lastName.trim() || null) !== (p.person.lastName ?? null) || year !== p.birthYear;
  return (
    <section class="stack-sm">
      <strong>
        <Trans context="person">Details</Trans>
      </strong>
      <div class="grid-2">
        <TextField label={t`First name`} value={firstName} onInput={setFirstName} maxLength={50} />
        <TextField label={t`Last name`} value={lastName} onInput={setLastName} maxLength={50} />
      </div>
      <TextField
        label={t`Year of birth`}
        value={birthYear}
        onInput={setBirthYear}
        inputMode="numeric"
        maxLength={4}
        placeholder={t`e.g. 2015`}
        error={yearInvalid ? t`Please enter a year such as 2015.` : null}
      />
      <Button
        disabled={busy || !changed || !firstName.trim() || yearInvalid}
        onClick={async () => {
          setBusy(true);
          try {
            await api.patch(`/persons/${p.person.id}`, { firstName: firstName.trim(), lastName: lastName.trim() || null, birthYear: year });
            toast(t`Details saved.`);
            onChanged();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Trans>Save details</Trans>
      </Button>
    </section>
  );
}

/** Delete permanently, with an overview of the consequences and name confirmation. */
function DeletePersonSection({ p, all, onDeleted }: { p: AdminPerson; all: AdminPerson[]; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const name = personName(p.person);
  // Parents without another child and without their own role are deleted too (as on the server)
  const orphanParents = p.parentIds
    .map((id) => all.find((x) => x.person.id === id))
    .filter((x): x is AdminPerson => !!x && !x.isAdmin && !x.teams.length && x.childIds.length === 1 && !x.parentIds.length);
  const teamNames = p.teams.map((m) => m.name).join(", ");
  const parentNames = orphanParents.map((x) => personName(x.person)).join(", ");
  const effects = [
    p.hasAccount ? t`the access with all devices and notifications` : "",
    p.teams.length ? t`the assignment to ${teamNames}` : "",
    t`all responses and nominations`,
    p.childIds.length ? t`the link to the children` : "",
    p.parentIds.length ? t`the link to the parents` : "",
    orphanParents.length ? t`${parentNames} (parent without another child)` : "",
    t`the profile picture`,
  ].filter(Boolean);
  return (
    <section class="stack-sm">
      <strong>
        <Trans>Delete</Trans>
      </strong>
      {!open ? (
        <Button variant="danger" icon="trash" onClick={() => setOpen(true)}>
          <Trans>Delete person permanently</Trans>
        </Button>
      ) : (
        <div class="stack-sm">
          <p class="small">
            <Trans>This cannot be undone. This deletes {name} and:</Trans>
          </p>
          <ul class="small" style={{ margin: 0, paddingLeft: "20px" }}>
            {effects.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
          <p class="small muted">
            <Trans>
              Chat messages remain and appear as “Deleted person”. If someone is only leaving the club, it is better to remove them via leaving the club in the team.
            </Trans>
          </p>
          <TextField label={t`Type “${name}” to confirm`} value={typed} onInput={setTyped} />
          <div class="btn-row">
            <Button
              variant="danger-solid"
              icon="trash"
              disabled={busy || typed.trim() !== name}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.del(`/admin/persons/${p.person.id}`);
                  toast(t`${name} has been deleted.`);
                  onDeleted();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trans>Delete for good</Trans>
            </Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setTyped(""); }}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function PersonAdminSheet({ p, all, selfId, onClose, onChanged }: { p: AdminPerson; all: AdminPerson[]; selfId: number; onClose: () => void; onChanged: () => void }) {
  const [email, setEmail] = useState(p.adminEmail ?? "");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const children = p.children;
  const firstName = p.person.firstName;
  const fullName = personName(p.person);
  const validUntil = link ? fullDate(isoToLocalDate(link.expiresAt)) : "";
  let lastSeen = activityLabel(p);
  if (p.lastSeenOn && p.hasAccount) {
    const date = fullDate(p.lastSeenOn);
    const ago = lastSeenAgo(p.lastSeenOn);
    lastSeen = t`Last active: ${date} (${ago})`;
  }
  return (
    <Sheet open onClose={onClose} title={personName(p.person)}>
      <p class="muted">
        {p.teams.map((m) => `${m.name} (${roleLabel(m.role, m.isGroup)})`).join(", ") || t`No team`}
        {children ? ` · ${t`Parent of ${children}`}` : ""}
      </p>
      <p class="small muted">{lastSeen}</p>
      <PersonDataSection key={p.person.id} p={p} onChanged={onChanged} />
      <TeamsSection p={p} onChanged={onChanged} />
      <section class="stack-sm">
        <strong>
          <Trans>Access</Trans>
        </strong>
        <p class="small muted">
          {p.hasAccount ? t`Has access.` : t`Has no access yet.`}{" "}
          <Trans>A personal one-time link sets up a new passkey and signs out the previous devices.</Trans>
        </p>
        <Button
          icon="link"
          onClick={async () => {
            setLink(await api.post<{ url: string; expiresAt: string }>(`/persons/${p.person.id}/personal-link`, {}));
          }}
        >
          <Trans>Create personal link</Trans>
        </Button>
        {link ? (
          <div class="stack-sm">
            <QrLink url={link.url} />
            <div class="url-box">{link.url}</div>
            <div class="btn-row">
              <Button
                variant="primary"
                icon="share"
                onClick={() => {
                  const club = clubName();
                  shareLink(club, t`Your personal access to the ${club} app`, link.url);
                }}
              >
                <Trans>Share</Trans>
              </Button>
              <Button icon="copy" onClick={() => copyText(link.url)}>
                <Trans>Copy</Trans>
              </Button>
            </div>
            <p class="small muted">
              <Trans>Valid until {validUntil}, can only be used once.</Trans>
            </p>
          </div>
        ) : null}
      </section>
      <AdminAvatar personId={p.person.id} name={personName(p.person)} />
      <SwitchRow
        label="KiHaSL/JuHaSL"
        sub={t`May be assigned as referee at all youth home games from F to C.`}
        checked={p.isReferee}
        onChange={async (on) => {
          if (on) await api.put(`/admin/referees/${p.person.id}`);
          else await api.del(`/admin/referees/${p.person.id}`);
          toast(on ? t`${firstName} is now enabled as KiHaSL/JuHaSL.` : t`${firstName} is no longer KiHaSL/JuHaSL.`);
          onChanged();
        }}
      />
      <SwitchRow
        label={t`Full club member`}
        sub={t`Only visible to admins. Full club members can help organise special events and take on duties with “Who helps: members”.`}
        checked={p.isClubMember}
        onChange={async (on) => {
          if (on) await api.put(`/admin/club-members/${p.person.id}`);
          else await api.del(`/admin/club-members/${p.person.id}`);
          toast(on ? t`${firstName} is a full club member.` : t`${firstName} is no longer a full club member.`);
          onChanged();
        }}
      />
      <FamilySection p={p} all={all} onChanged={onChanged} />
      <section class="stack-sm">
        <strong>
          <Trans>Admin</Trans>
        </strong>
        {p.isAdmin ? (
          <>
            <p class="small muted">
              {t`Admin`}
              {p.adminEmail ? ` · ${p.adminEmail}` : ""}
            </p>
            {p.person.id !== selfId ? (
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !(await confirmDialog({
                      title: t`Revoke admin rights?`,
                      message: t`${fullName} will then no longer be an admin.`,
                      confirmLabel: t`Revoke`,
                      danger: true,
                    }))
                  )
                    return;
                  await api.patch(`/admin/persons/${p.person.id}`, { isAdmin: false });
                  onClose();
                  onChanged();
                }}
              >
                <Trans>Revoke admin rights</Trans>
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <TextField
              label={t`E-mail (admins only)`}
              type="email"
              value={email}
              onInput={setEmail}
              hint={t`Only serves to identify the admin. Everyone sets the address for signing in themselves in their profile.`}
            />
            <Button
              onClick={async () => {
                await api.patch(`/admin/persons/${p.person.id}`, { isAdmin: true, adminEmail: email.trim() || null });
                toast(t`${firstName} is now an admin.`);
                onClose();
                onChanged();
              }}
            >
              <Trans>Make admin</Trans>
            </Button>
          </>
        )}
      </section>
      {p.person.id !== selfId ? <DeletePersonSection p={p} all={all} onDeleted={() => { onClose(); onChanged(); }} /> : null}
    </Sheet>
  );
}

// Age groups ---------------------------------------------------------------------------

export function AdminAgeClassesPage() {
  const { query } = useLocation();
  const seasonId = query.season;
  useDocumentTitle(t`Age groups`);
  const path = seasonId ? `/seasons/${seasonId}/age-classes` : "/age-classes";
  const { data, error, reload } = useQuery<{ season?: { name: string } | null; ageClasses: AgeClass[] }>(path);
  const [rows, setRows] = useState<AgeClass[] | null>(null);
  useEffect(() => {
    if (data) setRows(data.ageClasses);
  }, [data]);

  const update = (i: number, patch: Partial<AgeClass>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <AdminOnly>
      <main class="page">
        <TopBar
          title={t`Age groups`}
          kicker={seasonId ? t`Next season` : (data?.season?.name ?? t`Current season`)}
          back={seasonId ? "/verwaltung/saisonwechsel" : "/verwaltung"}
        />
        <div class="content">
          <Notice>
            <Trans>
              The association sets the birth years per season. Please check them against the competition rules. “Rank” orders the classes from young to old and
              determines which is the next higher youth class.
            </Trans>
          </Notice>
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!rows ? <Spinner /> : null}
          {rows ? (
            <div class="card scroll-x">
              <table class="table">
                <thead>
                  <tr>
                    <th>
                      <Trans context="age group">Code</Trans>
                    </th>
                    <th>
                      <Trans>Name</Trans>
                    </th>
                    <th>
                      <Trans>Rank</Trans>
                    </th>
                    <th>
                      <Trans>Youth</Trans>
                    </th>
                    <th>
                      <Trans>Born from</Trans>
                    </th>
                    <th>
                      <Trans>Born to</Trans>
                    </th>
                    <th>
                      <Trans>Game (min.)</Trans>
                    </th>
                    <th>
                      <Trans>Youth referee</Trans>
                    </th>
                    <th>
                      <span class="sr-only">
                        <Trans>Remove</Trans>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const name = r.name;
                    return (
                      <tr>
                        <td>
                          <input class="input" style={{ width: "64px" }} value={r.code} aria-label={t({ message: "Code", context: "age group" })} onInput={(e) => update(i, { code: (e.target as HTMLInputElement).value })} />
                        </td>
                        <td>
                          <input class="input" style={{ minWidth: "160px" }} value={r.name} aria-label={t`Name`} onInput={(e) => update(i, { name: (e.target as HTMLInputElement).value })} />
                        </td>
                        <td>
                          <input class="input" style={{ width: "52px" }} inputMode="numeric" value={r.rank} aria-label={t`Rank`} onInput={(e) => update(i, { rank: Number((e.target as HTMLInputElement).value) || 0 })} />
                        </td>
                        <td>
                          <input type="checkbox" checked={r.isYouth} aria-label={t`Youth`} onChange={(e) => update(i, { isYouth: (e.target as HTMLInputElement).checked })} style={{ width: "22px", height: "22px" }} />
                        </td>
                        <td>
                          <input class="input" style={{ width: "72px" }} inputMode="numeric" value={r.birthYearMin ?? ""} aria-label={t`Oldest year of birth`} onInput={(e) => update(i, { birthYearMin: num((e.target as HTMLInputElement).value) })} />
                        </td>
                        <td>
                          <input class="input" style={{ width: "72px" }} inputMode="numeric" value={r.birthYearMax ?? ""} aria-label={t`Youngest year of birth`} onInput={(e) => update(i, { birthYearMax: num((e.target as HTMLInputElement).value) })} />
                        </td>
                        <td>
                          <input class="input" style={{ width: "64px" }} inputMode="numeric" value={r.gameMinutes} aria-label={t`Game duration in minutes`} onInput={(e) => update(i, { gameMinutes: Number((e.target as HTMLInputElement).value) || 90 })} />
                        </td>
                        <td>
                          <input type="checkbox" checked={r.youthReferee} aria-label={t`Youth referee at home games`} onChange={(e) => update(i, { youthReferee: (e.target as HTMLInputElement).checked })} style={{ width: "22px", height: "22px" }} />
                        </td>
                        <td>
                          <button type="button" class="icon-btn" aria-label={t`Remove ${name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                            <Icon name="trash" size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {rows ? (
            <>
              <Button icon="plus" onClick={() => setRows([...rows, { code: "", name: "", rank: 1, isYouth: true, birthYearMin: null, birthYearMax: null, gameMinutes: 90, youthReferee: false }])}>
                <Trans>Add row</Trans>
              </Button>
              {!seasonId ? (
                <Button
                  variant="ghost"
                  icon="refresh"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t`Use the sport's age groups?`,
                      message: t`Replaces the rows above with the age groups of the club's sport for this season. Nothing is saved until you tap Save.`,
                      confirmLabel: t`Use them`,
                    });
                    if (!ok) return;
                    setRows((await api.get<{ ageClasses: AgeClass[] }>("/age-classes/from-profile")).ageClasses);
                  }}
                >
                  <Trans>Age groups of the sport</Trans>
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="lg"
                onClick={async () => {
                  await api.put(path, { ageClasses: rows.map((r) => ({ ...r, code: r.code.trim(), name: r.name.trim() })) });
                  toast(t`Age groups saved.`);
                  invalidate(path, "/teams");
                }}
              >
                <Trans>Save</Trans>
              </Button>
            </>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}

// Holidays ------------------------------------------------------------------------------

interface HolidayPeriod {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  imported: boolean;
  /** Linked holiday plans that follow changes */
  plans: number;
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function AdminHolidaysPage() {
  useDocumentTitle(t`Holidays`);
  const { data, error, reload } = useQuery<{ periods: HolidayPeriod[]; publicHolidays?: { day: string; name: string }[]; source: string }>("/holidays");
  const [editing, setEditing] = useState<HolidayPeriod | "new" | null>(null);
  const today = todayLocal();
  const source = data?.source ?? "OpenHolidays API";
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Holidays`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          <p class="muted">
            <Trans>
              Named holiday periods. Each one can be changed or deleted. Team holiday plans linked to a period follow its changes. The school holidays of
              the club's region are imported at the season change (source: {source}).
            </Trans>
          </p>
          <Button icon="plus" onClick={() => setEditing("new")}>
            <Trans>Add period</Trans>
          </Button>
          <section class="stack-sm" aria-label={t`Holiday periods`}>
            {!data && !error ? <Spinner /> : null}
            {data && !data.periods.length ? (
              <Empty title={t`No holidays`}>
                <Trans>Add periods or import them at the next season change.</Trans>
              </Empty>
            ) : null}
            <ul class="list">
              {(data?.periods ?? []).map((p) => {
                const days = dayCount(p.startsOn, p.endsOn);
                const plans = p.plans;
                return (
                  <li>
                    <button type="button" class="list-row" style={{ opacity: p.endsOn < today ? 0.6 : 1 }} onClick={() => setEditing(p)}>
                      <Icon name="sun" size={20} />
                      <span class="main">
                        <span class="title">{p.name}</span>
                        <span class="sub">
                          {fullDate(p.startsOn)} – {fullDate(p.endsOn)} · {plural(days, { one: "# day", other: "# days" })}
                          {plans ? ` · ${plural(plans, { one: "# holiday plan", other: "# holiday plans" })}` : ""}
                        </span>
                      </span>
                      <Icon name="chevron" size={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {data?.publicHolidays?.length ? (
            <section class="stack-sm" aria-label={t`Public holidays`}>
              <h2 class="section-title">
                <Trans>Public holidays</Trans>
              </h2>
              <p class="small muted">
                <Trans>No trainings are created on these days. Remove a day if your teams train on it after all.</Trans>
              </p>
              <ul class="list">
                {data.publicHolidays.map((h) => {
                  const name = h.name;
                  return (
                    <li class="list-row">
                      <Icon name="calendar" size={20} />
                      <span class="main">
                        <span class="title">{h.name}</span>
                        <span class="sub">{fullDate(h.day)}</span>
                      </span>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={t`Remove public holiday ${name}`}
                        onClick={async () => {
                          await api.del(`/public-holidays/${h.day}`);
                          invalidate("/holidays", "/events");
                          await reload();
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
        {editing ? (
          <HolidaySheet
            period={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onDone={async () => {
              setEditing(null);
              invalidate("/holidays", "/events");
              await reload();
            }}
          />
        ) : null}
      </main>
    </AdminOnly>
  );
}

function HolidaySheet({ period, onClose, onDone }: { period: HolidayPeriod | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(period?.name ?? "");
  const [from, setFrom] = useState(period?.startsOn ?? "");
  const [to, setTo] = useState(period?.endsOn ?? "");
  const valid = name.trim() && from && to && from <= to;
  const plans = period?.plans ?? 0;
  return (
    <Sheet open onClose={onClose} title={period ? period.name : t`New holiday period`}>
      <TextField label={t`Name`} value={name} onInput={setName} maxLength={60} placeholder={t`e.g. carnival holidays`} />
      <div class="grid-2">
        <Field label={t`From`}>{(id) => <input id={id} class="input" type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />}</Field>
        <Field label={t`To`}>{(id) => <input id={id} class="input" type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />}</Field>
      </div>
      {from && to && from > to ? (
        <p class="small warn-text">
          <Trans>The end must be after the start.</Trans>
        </p>
      ) : null}
      {plans ? (
        <p class="small muted">
          {plural(plans, {
            one: "One holiday plan is linked to this period and takes over new dates automatically.",
            other: "# holiday plans are linked to this period and take over new dates automatically.",
          })}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!valid}
        onClick={async () => {
          const body = { name: name.trim(), startsOn: from, endsOn: to };
          if (period) await api.patch(`/holidays/${period.id}`, body);
          else await api.post("/holidays", body);
          toast(period ? t`Saved. Trainings have been adjusted.` : t`Holiday period created.`);
          onDone();
        }}
      >
        <Trans>Save</Trans>
      </Button>
      {period ? (
        <Button
          variant="danger"
          block
          onClick={async () => {
            const periodName = period.name;
            const ok = await confirmDialog({
              title: t`Delete ${periodName}?`,
              message: period.plans ? t`Linked holiday plans keep their dates but no longer follow changes.` : t`The period is removed from the list.`,
              confirmLabel: t`Delete`,
              danger: true,
            });
            if (!ok) return;
            await api.del(`/holidays/${period.id}`);
            toast(t`Holiday period deleted.`);
            onDone();
          }}
        >
          <Trans>Delete</Trans>
        </Button>
      ) : null}
    </Sheet>
  );
}

// Venues ------------------------------------------------------------------------------

export function AdminLocationsPage() {
  useDocumentTitle(t`Training venues`);
  const { data, error, reload } = useQuery<{ locations: (LocationRef & { inUse: boolean })[] }>("/locations?all=1");
  const [edit, setEdit] = useState<(LocationRef & { inUse: boolean }) | null>(null);
  const groups: { kind: LocationRef["kind"]; title: string }[] = [
    { kind: "hall", title: t`Club halls` },
    { kind: "custom", title: t`Other training venues` },
    { kind: "external", title: t`Opponents' halls (from the fixture list)` },
  ];
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Training venues`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data ? <Spinner /> : null}
          {groups.map((g) => {
            const items = (data?.locations ?? []).filter((l) => l.kind === g.kind);
            if (!items.length) return null;
            return (
              <section class="stack-sm" aria-label={g.title}>
                <h2 class="section-title">{g.title}</h2>
                <ul class="list">
                  {items.map((l) => (
                    <li>
                      <button type="button" class="list-row" onClick={() => setEdit(l)}>
                        <Icon name="pin" size={20} />
                        <span class="main">
                          <span class="title">{l.name}</span>
                          <span class="sub">{l.address ?? t`Address missing`}</span>
                        </span>
                        <Icon name="edit" size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {edit ? <LocationSheet loc={edit} onClose={() => setEdit(null)} onDone={reload} /> : null}
      </main>
    </AdminOnly>
  );
}

function LocationSheet({ loc, onClose, onDone }: { loc: LocationRef & { inUse: boolean }; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(loc.name);
  const [address, setAddress] = useState(loc.address ?? "");
  const [mapUrl, setMapUrl] = useState(loc.mapUrl ?? "");
  return (
    <Sheet open onClose={onClose} title={t`Edit venue`}>
      <TextField label={t`Name`} value={name} onInput={setName} maxLength={80} />
      <TextField label={t`Address`} value={address} onInput={setAddress} maxLength={200} />
      <TextField label={t`Map link (optional)`} value={mapUrl} onInput={setMapUrl} type="url" hint={t`https link, e.g. to OpenStreetMap`} />
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.patch(`/locations/${loc.id}`, { name: name.trim(), address: address.trim() || null, mapUrl: mapUrl.trim() || null });
          invalidate("/locations", "/events");
          toast(t`Saved.`);
          onClose();
          onDone();
        }}
      >
        <Trans>Save</Trans>
      </Button>
      {loc.kind !== "hall" ? (
        <Button
          variant="ghost"
          icon="trash"
          disabled={loc.inUse}
          onClick={async () => {
            await api.del(`/locations/${loc.id}`);
            invalidate("/locations");
            onClose();
            onDone();
          }}
        >
          {loc.inUse ? t`Used in a plan` : t`Delete venue`}
        </Button>
      ) : null}
    </Sheet>
  );
}

/** Upcoming, manually created events of other teams (own ones are under Events). */
export function AdminExtraEventsPage() {
  useDocumentTitle(t`Special events and games`);
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Special events and games`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <p class="small muted">
            <Trans>
              Upcoming special events and games without handball4all of all teams. Events you already see under Events are not listed here. Tap to open the event,
              where you can edit, cancel or delete it.
            </Trans>
          </p>
          <a class="btn btn-primary" href="/verwaltung/termin-neu">
            <Icon name="plus" size={18} />
            <Trans>Create special event</Trans>
          </a>
          <p class="small muted">
            <Trans>You create games without handball4all in the team (Team → Create event).</Trans>
          </p>
          <ExtraEventList path="/admin/extra-events" empty={t`All upcoming special events and games are in your event overview.`} />
        </div>
      </main>
    </AdminOnly>
  );
}
