import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName, useModule } from "../club";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { renderSVG } from "uqr";
import type { PersonRef } from "../../shared/types";
import { api, errorMessage } from "../api";
import type { DutyTypeInfo, TemplateInfo } from "../duty-blocks";
import { fullDate, isoToLocalDate, personName } from "../format";
import { PersonAvatar } from "../avatar";
import { SourceBar } from "./games";
import { Icon } from "../icons";
import { ExtraEventList } from "../extra-events";
import { GroupPage } from "./group";
import { useMe, useSession } from "../session";
import { PlayerListImport } from "../player-import";
import { GameImport } from "../game-import";
import { invalidate, useQuery } from "../store";
import {
  Button,
  confirmDialog,
  copyText,
  Empty,
  ErrorBox,
  Field,
  Notice,
  Segmented,
  Sheet,
  shareLink,
  Spinner,
  SwitchRow,
  TextField,
  toast,
  TopBar,
  useDocumentTitle,
} from "../ui";

export interface TeamDetail {
  id: number;
  name: string;
  /** Group: only chat and special events (src/pages/group.tsx). */
  kind: "team" | "group";
  autoMembers: "referees" | null;
  ageClassCode: string;
  ageClassName: string;
  level: number;
  /** Parents are included (admin setting). */
  parentsEnabled: boolean;
  declineHoursTraining: number;
  declineHoursGame: number;
  maxSquad: number;
  autoSquad: boolean;
  helperPlan: boolean;
  homeTemplateId: number | null;
  awayTemplateId: number | null;
  showResponses: boolean;
  h4a: { orgId: number | null; leagueId: number | null; teamId: number | null; importedAt: string | null; error: string | null };
  coaches: { person: PersonRef; hasAccount: boolean }[];
  /** Team staff (physio, manager): see everything of the team, take no part */
  staff: { person: PersonRef; hasAccount: boolean; hasPush: boolean }[];
  players: {
    person: PersonRef;
    birthYear: number | null;
    isActive: boolean;
    hasAccount: boolean;
    /** Push on at least one device */
    hasPush: boolean;
    isCore: boolean;
    /** How often absent without excuse this season */
    unexcused: number;
    ageWarning: string | null;
    guardians: { id: number; firstName: string; lastName: string | null; hasAccount: boolean; hasPush: boolean }[];
  }[];
  helpers: { person: PersonRef; homeTeam: string | null; trainings: boolean; isActive: boolean; isCore: boolean; unexcused: number }[];
  invites: { player: InviteView | null; parent: InviteView | null };
  duplicateNames: string[];
  missingLastNames: number;
  missingBirthYears: number;
}

interface InviteView {
  id: number;
  url: string;
  expiresAt: string;
}

export function TeamIndexPage() {
  useDocumentTitle(t`Team`);
  const me = useMe();
  const { route } = useLocation();
  useEffect(() => {
    if (me.manageableTeams.length === 1) route(`/team/${me.manageableTeams[0]!.id}`, true);
  }, []);
  return (
    <main class="page">
      <TopBar title={me.manageableTeams.some((team) => me.groupIds.includes(team.id)) ? t`Teams and groups` : t({ message: "My teams", context: "coach" })} kicker={t`Team`} />
      <div class="content">
        {!me.manageableTeams.length ? (
          <Empty title={t`No team`}>
            <Trans>You are not registered as a coach for any team.</Trans>
          </Empty>
        ) : null}
        <ul class="list">
          {me.manageableTeams.map((t) => (
            <li>
              <a class="list-row" href={`/team/${t.id}`}>
                <span class="team-badge">{t.name}</span>
                <span class="main">
                  <span class="title">{t.name}</span>
                  {me.groupIds.includes(t.id) ? (
                    <span class="sub">
                      <Trans>Group · chat and special events only</Trans>
                    </span>
                  ) : null}
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

type Tab = "kader" | "einladungen" | "einstellungen";

export function TeamPage({ id }: { id: string }) {
  const me = useMe();
  const { data: team, error, loading, reload } = useQuery<TeamDetail>(`/teams/${id}`);
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem(`team-tab-${id}`) as Tab) || "kader");
  const teamName = team?.name ?? "";
  useDocumentTitle(team ? t`Team ${teamName}` : t`Team`);
  useEffect(() => sessionStorage.setItem(`team-tab-${id}`, tab), [tab]);

  if (loading) return <Spinner />;
  if (error || !team) {
    return (
      <main class="page">
        <TopBar title={t`Team`} back="/" />
        <div class="content">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      </main>
    );
  }
  if (team.kind === "group") return <GroupPage team={team} onChanged={reload} />;
  const level = team.level;
  const playerCount = team.players.length;
  const reachable = team.players.filter((p) => p.hasAccount || p.guardians.some((g) => g.hasAccount)).length;
  return (
    <main class="page">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">
            {team.ageClassName}
            {team.level > 1 ? " · " + t`Team ${level}` : ""}
          </div>
          {me.isAdmin || me.manageableTeams.length > 1 ? (
            <a class="team-badge outline" href={me.isAdmin ? "/verwaltung/mannschaften" : "/team"} style={{ textDecoration: "none" }}>
              <Trans>Switch</Trans>
            </a>
          ) : null}
        </div>
        <h1>
          <Trans>Team {teamName}</Trans>
        </h1>
        <div class="hero-sub">
          {plural(playerCount, { one: "# player", other: "# players" })} · {t`${reachable} reachable via the app`}
        </div>
      </header>
      <div class="content">
        <div class="grid-2">
          <a class="btn btn-primary" href={`/team/${team.id}/plaene`}>
            <Icon name="calendar" size={18} />
            <Trans>Training plans</Trans>
          </a>
          <a class="btn" href={`/team/${team.id}/termin-neu`}>
            <Icon name="plus" size={18} />
            <Trans>Create event</Trans>
          </a>
        </div>
        <details class="card howto-fold faq">
          <summary>
            <span>
              <Trans>Special events and own games</Trans>
            </span>
            <Icon name="chevron" size={18} />
          </summary>
          <div class="card-body stack-sm">
            <p class="small muted">
              <Trans>Upcoming events created by hand. Tap one to open it for editing, cancelling or deleting.</Trans>
            </p>
            <ExtraEventList path={`/teams/${team.id}/extra-events`} empty={t`No upcoming special events or games without handball4all yet.`} showTeams={false} />
          </div>
        </details>
        <Segmented<Tab>
          label={t`Section`}
          value={tab}
          onChange={setTab}
          options={[
            { value: "kader", label: t`Squad` },
            { value: "einladungen", label: t`Invitations` },
            { value: "einstellungen", label: t`Settings` },
          ]}
        />
        {tab === "kader" ? <RosterTab team={team} onChanged={reload} /> : null}
        {tab === "einladungen" ? <InvitesTab team={team} onChanged={reload} /> : null}
        {tab === "einstellungen" ? <SettingsTab team={team} onChanged={reload} /> : null}
        {/* Coaches have no Help tab; admins find it under Administration */}
        {!me.isAdmin ? (
          <ul class="list">
            <li>
              <a class="list-row" href="/hilfe">
                <Icon name="info" size={22} />
                <span class="main">
                  <span class="title">
                    <Trans>Help and feedback</Trans>
                  </span>
                  <span class="sub">
                    <Trans>FAQ, guides, feedback on the app</Trans>
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          </ul>
        ) : null}
      </div>
    </main>
  );
}

/** Core squad: players and permanent stand-ins. */
function coreIds(team: TeamDetail): number[] {
  return [...team.players, ...team.helpers].filter((p) => p.isCore).map((p) => p.person.id);
}

function unexcusedLabel(count: number): string {
  return t`${count}× unexcused`;
}

function birthYearLabel(year: number | null): string {
  return year ? t({ message: `Born ${year}`, context: "abbreviated" }) : t`Year of birth missing`;
}

function guardiansLabel(guardians: TeamDetail["players"][number]["guardians"]): string {
  const names = guardians
    .map((g) => {
      const name = g.firstName;
      return g.hasAccount ? name : t`${name} (no access)`;
    })
    .join(", ");
  return t`Parents: ${names}`;
}

/** Note for a stand-in: where they come from. */
function helperNote(homeTeam: string | null): string {
  return homeTeam ? t`Stand-in from ${homeTeam}` : t`Stand-in from the other team`;
}

function helperSubLabel(homeTeam: string): string {
  return t`from ${homeTeam} · sees games`;
}

function missingLastNamesLabel(count: number): string {
  return t`${count} without last name`;
}

function missingBirthYearsLabel(count: number): string {
  return t`${count} without year of birth`;
}

function RosterTab({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [coreOpen, setCoreOpen] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const names = team.duplicateNames.join(", ");
  const missing = [
    team.missingLastNames ? missingLastNamesLabel(team.missingLastNames) : "",
    team.missingBirthYears ? missingBirthYearsLabel(team.missingBirthYears) : "",
  ]
    .filter(Boolean)
    .join(", ");
  const playerCount = team.players.length;
  const helperCount = team.helpers.length;
  const coachCount = team.coaches.length;
  return (
    <>
      {team.duplicateNames.length ? (
        <Notice kind="warn">
          <Trans>
            Same names in the squad: <strong>{names}</strong>. Please add the last names before you share the player link, otherwise the selection is ambiguous.
          </Trans>
        </Notice>
      ) : null}
      {team.missingLastNames || team.missingBirthYears ? (
        <Notice>
          <Trans>{missing}. Tap a person to add it.</Trans>
        </Notice>
      ) : null}

      <section class="stack-sm" aria-label={t({ message: "Players", context: "list" })}>
        <div class="row-gap" style={{ justifyContent: "space-between" }}>
          <h2 class="section-title">
            <Trans>Players · {playerCount}</Trans>
          </h2>
          <Button size="sm" icon="plus" onClick={() => setAddOpen(true)}>
            <Trans>Add</Trans>
          </Button>
        </div>
        {!team.players.length ? (
          <Empty title={t`No one in the squad yet`}>
            <Trans>First add the players.</Trans>
          </Empty>
        ) : null}
        <ul class="list">
          {team.players.map((p) => (
            <li>
              <a class="list-row" href={`/team/${team.id}/person/${p.person.id}`}>
                <PersonAvatar personId={p.person.id} name={p.person.firstName} />
                <span class="main">
                  <span class="title" style={{ color: p.isActive ? undefined : "var(--text-2)" }}>
                    {personName(p.person)}{" "}
                    {p.isCore ? (
                      <span class="badge outline">
                        <Trans>Core</Trans>
                      </span>
                    ) : null}{" "}
                    {!p.isActive ? (
                      <span class="badge muted">
                        <Trans>Inactive</Trans>
                      </span>
                    ) : null}{" "}
                    {p.unexcused ? <span class="badge warn">{unexcusedLabel(p.unexcused)}</span> : null}
                  </span>
                  <span class="sub">
                    {birthYearLabel(p.birthYear)} · {p.hasAccount ? t`own access` : t`no own access`}
                    {p.guardians.length ? " · " + guardiansLabel(p.guardians) : ""}
                  </span>
                  {p.ageWarning ? <span class="small warn-text">{p.ageWarning}</span> : null}
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          ))}
        </ul>
        {team.players.length || team.helpers.length ? (
          <Button variant="ghost" size="sm" icon="star" onClick={() => setCoreOpen(true)}>
            <Trans>Set core squad</Trans>
          </Button>
        ) : null}
      </section>

      <section class="stack-sm" aria-label={t`Stand-ins`}>
        <div class="row-gap" style={{ justifyContent: "space-between" }}>
          <h2 class="section-title">
            <Trans>Stand-ins · {helperCount}</Trans>
          </h2>
          <Button size="sm" icon="plus" onClick={() => setHelperOpen(true)}>
            <Trans>Add</Trans>
          </Button>
        </div>
        {team.helpers.length ? (
          <ul class="list">
            {team.helpers.map((h) => {
              const firstName = h.person.firstName;
              const name = personName(h.person);
              const teamName = team.name;
              return (
                <li>
                  <div class="list-row">
                    <span class="main">
                      <span class="title">
                        {personName(h.person)}{" "}
                        {h.isCore ? (
                          <span class="badge outline">
                            <Trans>Core</Trans>
                          </span>
                        ) : null}{" "}
                        {h.unexcused ? <span class="badge warn">{unexcusedLabel(h.unexcused)}</span> : null}
                      </span>
                      <span class="sub">{h.homeTeam ? helperSubLabel(h.homeTeam) : t`from the other team · sees games`}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t`Remove ${firstName} as a stand-in`}
                      onClick={async () => {
                        if (!(await confirmDialog({ title: t`Remove stand-in?`, message: t`${name} will then no longer be a permanent stand-in for ${teamName}.`, confirmLabel: t`Remove` }))) return;
                        await api.del(`/teams/${team.id}/members/${h.person.id}?role=helper`);
                        onChanged();
                      }}
                    >
                      <Icon name="trash" size={18} />
                    </Button>
                  </div>
                  <SwitchRow
                    label={t`Also sees trainings`}
                    checked={h.trainings}
                    onChange={async (trainings) => {
                      await api.patch(`/teams/${team.id}/helpers/${h.person.id}`, { trainings });
                      onChanged();
                    }}
                  />
                  <SwitchRow
                    label={t`Core squad`}
                    checked={h.isCore}
                    onChange={async (core) => {
                      const ids = coreIds(team);
                      await api.put(`/teams/${team.id}/core-squad`, { personIds: core ? [...ids, h.person.id] : ids.filter((x) => x !== h.person.id) });
                      onChanged();
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="small muted">
            <Trans>Permanent stand-ins from the younger youth team or the second team see your games and can accept and decline.</Trans>
          </p>
        )}
      </section>

      <StaffSection team={team} onChanged={onChanged} />

      <section class="stack-sm" aria-label={t({ message: "Coaches", context: "short" })}>
        <h2 class="section-title">
          <Trans>Coaches · {coachCount}</Trans>
        </h2>
        <ul class="list">
          {team.coaches.map((c) => (
            <li class="list-row">
              <span class="main">
                <span class="title">{personName(c.person)}</span>
                <span class="sub">{c.hasAccount ? t`has access set up` : t`no access yet`}</span>
              </span>
            </li>
          ))}
        </ul>
        <p class="small muted">
          <Trans>An admin assigns coaches.</Trans>
        </p>
      </section>

      {addOpen ? <AddPlayerSheet team={team} onClose={() => setAddOpen(false)} onDone={onChanged} /> : null}
      {coreOpen ? <CoreSheet team={team} onClose={() => setCoreOpen(false)} onDone={onChanged} /> : null}
      {helperOpen ? <HelperSheet team={team} onClose={() => setHelperOpen(false)} onDone={onChanged} /> : null}
    </>
  );
}

/** Team staff: physio, manager, kit manager. They see events, who takes part and the chat, without responding. */
function StaffSection({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<TeamDetail["staff"][number] | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const staffCount = team.staff.length;
  const close = () => {
    setOpen(null);
    setLink(null);
  };
  const name = open ? personName(open.person) : "";
  const linkExpires = link ? fullDate(isoToLocalDate(link.expiresAt)) : "";
  return (
    <section class="stack-sm" aria-label={t({ message: "Staff", context: "team role" })}>
      <div class="row-gap">
        <h2 class="section-title" style={{ flex: 1 }}>
          <Trans>Staff · {staffCount}</Trans>
        </h2>
        <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
          <Trans>Add</Trans>
        </Button>
      </div>
      {team.staff.length ? (
        <ul class="list">
          {team.staff.map((m) => (
            <li>
              <button type="button" class="list-row" onClick={() => setOpen(m)}>
                <span class="main">
                  <span class="title">{personName(m.person)}</span>
                  <span class="sub">{m.hasAccount ? (m.hasPush ? t`has access set up` : t`access without notifications`) : t`no access yet`}</span>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted">
          <Trans>Physio, team manager or kit manager: they see the events, who takes part and the chat, and get changes. They do not respond themselves.</Trans>
        </p>
      )}
      {adding ? (
        <Sheet open onClose={() => setAdding(false)} title={t`Add staff`}>
          <TextField label={t`First name`} value={first} onInput={setFirst} maxLength={50} />
          <TextField label={t`Last name`} value={last} onInput={setLast} maxLength={50} />
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!first.trim()}
            onClick={async () => {
              await api.post(`/teams/${team.id}/staff`, { firstName: first.trim(), lastName: last.trim() || null });
              setFirst("");
              setLast("");
              setAdding(false);
              onChanged();
            }}
          >
            <Trans>Add</Trans>
          </Button>
          <p class="small muted">
            <Trans>Afterwards, open the person and create a personal link for the access.</Trans>
          </p>
        </Sheet>
      ) : null}
      {open ? (
        <Sheet open onClose={close} title={name}>
          {link ? (
            <>
              <p class="small muted">
                <Trans>Personal one-time link, valid until {linkExpires}. Please pass it on directly to {name} only.</Trans>
              </p>
              <QrLink url={link.url} />
              <div class="url-box">{link.url}</div>
              <div class="btn-row">
                <Button
                  variant="primary"
                  icon="share"
                  onClick={() => {
                    const club = clubName();
                    return shareLink(club, t`Your personal access to the ${club} app`, link.url);
                  }}
                >
                  <Trans>Share</Trans>
                </Button>
                <Button icon="copy" onClick={() => copyText(link.url)}>
                  <Trans>Copy</Trans>
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="primary"
              block
              onClick={async () => setLink(await api.post<{ url: string; expiresAt: string }>(`/persons/${open.person.id}/personal-link`, {}))}
            >
              {open.hasAccount ? t`Link for new passkey` : t`Personal invitation link`}
            </Button>
          )}
          <Button
            variant="ghost"
            icon="trash"
            onClick={async () => {
              const ok = await confirmDialog({
                title: t`Remove ${name} from the team?`,
                message: t`The person no longer sees the team's events and chat.`,
                confirmLabel: t`Remove`,
                danger: true,
              });
              if (!ok) return;
              await api.del(`/teams/${team.id}/members/${open.person.id}?role=staff`);
              close();
              onChanged();
            }}
          >
            <Trans>Remove from the team</Trans>
          </Button>
        </Sheet>
      ) : null}
    </section>
  );
}

function AddPlayerSheet({ team, onClose, onDone }: { team: TeamDetail; onClose: () => void; onDone: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [year, setYear] = useState("");
  const [mode, setMode] = useState<"new" | "list" | "existing">("new");
  return (
    <Sheet open onClose={onClose} title={t`Add player`}>
      <Segmented
        label={t`Source`}
        value={mode}
        options={[
          { value: "new", label: t`Create new` },
          { value: "list", label: t`From a list` },
          { value: "existing", label: t`From another team` },
        ]}
        onChange={setMode}
      />
      {mode === "list" ? <PlayerListImport teamId={team.id} onDone={onDone} /> : null}
      {mode === "existing" ? <ExistingPlayerPicker team={team} onDone={onDone} /> : null}
      {mode === "new" ? (
        <>
          <TextField label={t`First name`} value={first} onInput={setFirst} maxLength={50} />
          <TextField label={t`Last name`} value={last} onInput={setLast} maxLength={50} />
          <TextField
            label={t`Birth year`}
            value={year}
            onInput={setYear}
            inputMode="numeric"
            maxLength={4}
            hint={t`Only the year. The app stores no further data.`}
          />
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!first.trim()}
            onClick={async () => {
              const birthYear = year.trim() ? Number(year) : null;
              if (birthYear != null && (!Number.isInteger(birthYear) || birthYear < 1930 || birthYear > 2100)) {
                toast(t`Please enter a valid year of birth.`, "error");
                return;
              }
              await api.post(`/teams/${team.id}/players`, { firstName: first.trim(), lastName: last.trim() || null, birthYear });
              const name = first.trim();
              toast(t`${name} is in the squad.`);
              setFirst("");
              setLast("");
              setYear("");
              onDone();
            }}
          >
            <Trans>Add</Trans>
          </Button>
          <p class="small muted">
            <Trans>The person can then set up access via the player link.</Trans>
          </p>
        </>
      ) : null}
    </Sheet>
  );
}

/** Players of another team of the same or the next younger age class, who then play in both. */
function ExistingPlayerPicker({ team, onDone }: { team: TeamDetail; onDone: () => void }) {
  const { data, error, reload } = useQuery<{ candidates: { person: PersonRef; teams: string; isActive: boolean }[] }>(`/teams/${team.id}/player-candidates`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const teamName = team.name;
  return (
    <div class="stack-sm">
      <p class="small muted">
        <Trans>The person stays in their current team and also plays for {teamName}. Their coaches are informed.</Trans>
      </p>
      {!data.candidates.length ? (
        <Empty title={t`No one found`}>
          <Trans>There is no one in the matching teams who does not already play here.</Trans>
        </Empty>
      ) : null}
      <ul class="list">
        {data.candidates.map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">
                {c.teams}
                {c.isActive ? "" : " · " + t`inactive`}
              </span>
            </span>
            <Button
              size="sm"
              onClick={async () => {
                await api.post(`/teams/${team.id}/players/existing`, { personId: c.person.id });
                const name = c.person.firstName;
                toast(t`${name} now also plays for ${teamName}.`);
                void reload();
                onDone();
              }}
            >
              <Trans>Add to squad</Trans>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CoreSheet({ team, onClose, onDone }: { team: TeamDetail; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState(coreIds(team));
  const count = ids.length;
  return (
    <Sheet open onClose={onClose} title={t`Core squad`}>
      <p class="muted">
        {team.autoSquad
          ? t`The core squad is automatically nominated for all games. Changes apply immediately to all future games whose squad you have not adjusted by hand.`
          : t`The core squad is preselected for every new game.`}
      </p>
      <ul class="list">
        {[...team.players.map((p) => ({ person: p.person, note: null as string | null })), ...team.helpers.map((h) => ({ person: h.person, note: helperNote(h.homeTeam) }))].map((p) => {
          const on = ids.includes(p.person.id);
          return (
            <li>
              <button
                type="button"
                class={`squad-row ${on ? "on" : ""}`}
                role="checkbox"
                aria-checked={on ? "true" : "false"}
                onClick={() => setIds(on ? ids.filter((x) => x !== p.person.id) : [...ids, p.person.id])}
              >
                <span class={`check ${on ? "on" : ""}`}>{on ? <Icon name="check" size={16} stroke={3} /> : null}</span>
                <span style={{ fontWeight: 700 }}>{personName(p.person)}</span>
                {p.note ? <span class="small muted">{p.note}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.put(`/teams/${team.id}/core-squad`, { personIds: ids });
          toast(t`Core squad saved (${count}).`);
          onClose();
          onDone();
        }}
      >
        <Trans>Save · {count}</Trans>
      </Button>
    </Sheet>
  );
}

function HelperSheet({ team, onClose, onDone }: { team: TeamDetail; onClose: () => void; onDone: () => void }) {
  const { data, error } = useQuery<{ candidates: { person: PersonRef; team: { id: number; name: string }; isActive: boolean }[] }>(`/teams/${team.id}/helper-candidates`);
  return (
    <Sheet open onClose={onClose} title={t`Permanent stand-in`}>
      <p class="muted">
        <Trans>From the second team of the same age class or the next younger youth team.</Trans>
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {!data ? <Spinner /> : null}
      {data && !data.candidates.length ? (
        <Notice>
          <Trans>No matching players found.</Trans>
        </Notice>
      ) : null}
      <ul class="list">
        {(data?.candidates ?? []).map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">{c.team.name}</span>
            </span>
            {team.helpers.some((h) => h.person.id === c.person.id) ? (
              <span class="pill pill-muted">
                <Trans>Stand-in</Trans>
              </span>
            ) : (
              <Button
                size="sm"
                onClick={async () => {
                  await api.post(`/teams/${team.id}/helpers`, { personId: c.person.id, trainings: false });
                  const name = c.person.firstName;
                  toast(t`${name} is now a stand-in.`);
                  onDone();
                }}
              >
                <Trans>Add</Trans>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function QrLink({ url }: { url: string }) {
  return <div class="qr" role="img" aria-label={t`QR code of the link`} dangerouslySetInnerHTML={{ __html: renderSVG(url, { border: 1 }) }} />;
}

/** Accompanying text for WhatsApp & co.: what the link is, once per person, note for those already registered. */
export function inviteMessage(kind: "player" | "parent", teamName: string, url: string, expires: string): string {
  const club = clubName();
  const install = t`Then get the app onto your phone: on iPhone in Safari via "Share" → "Add to Home Screen", on Android via "Install app" in the browser menu.`;
  if (kind === "player") {
    return [
      t`Hi everyone! ${teamName} uses the ${club} app for events, responses and the team chat.`,
      t`How it works: open the link, select your own name and set up a passkey (Face ID, fingerprint or screen lock).`,
      t`Important: everyone uses the link only once, for themselves. Please select only your own name.`,
      t`Your name is greyed out? Then you already have access. Just open the app and sign in.`,
      install,
      t`The link is valid until ${expires}:`,
      url,
    ].join("\n\n");
  }
  return [
    t`Dear parents of ${teamName}, we use the ${club} app for events, responses, helper duties and the team chat.`,
    t`How it works: open the link, enter your own name, select your child (siblings in the same team right away too) and set up a passkey.`,
    t`Important: each parent uses the link only once, for themselves. This is not a link for players!`,
    t`Already in the app, e.g. for a sibling in another team or as a coach? Then open the link on the phone where the app is installed and sign in first. Otherwise a second access is created.`,
    install,
    t`The link is valid until ${expires}:`,
    url,
  ].join("\n\n");
}

function InviteCard(props: { team: TeamDetail; kind: "player" | "parent"; invite: InviteView | null; onChanged: () => void }) {
  const { team, kind, invite } = props;
  const title = kind === "player" ? t`Player link` : t`Parent link`;
  const text =
    kind === "player"
      ? t`Players with their own smartphone select their name and set up a passkey.`
      : t`Parents enter their name, select their child (or several) and set up a passkey. The link takes effect immediately.`;
  const expires = invite ? fullDate(isoToLocalDate(invite.expiresAt)) : "";
  const message = invite ? inviteMessage(kind, team.name, invite.url, expires) : "";
  const create = async () => {
    if (invite && !(await confirmDialog({ title: t`Create a new link?`, message: t`The previous link will then stop working.`, confirmLabel: t`New link` }))) return;
    await api.post(`/teams/${team.id}/invites`, { kind });
    toast(t`New link created.`);
    props.onChanged();
  };
  return (
    <section class="card card-body" aria-label={title}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <h2 class="section-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {invite ? (
          <span class="small muted">
            <Trans>valid until {expires}</Trans>
          </span>
        ) : null}
      </div>
      <p class="muted">{text}</p>
      {invite ? (
        <>
          <QrLink url={invite.url} />
          <div class="url-box">{invite.url}</div>
          <div class="btn-row">
            <Button variant="primary" icon="share" onClick={() => shareLink(`${title} ${team.name}`, message, "")}>
              <Trans>Share with text</Trans>
            </Button>
            <Button icon="copy" onClick={() => copyText(message, t`Text with link copied.`)}>
              <Trans>Copy text</Trans>
            </Button>
          </div>
          <Button size="sm" variant="ghost" icon="copy" onClick={() => copyText(invite.url, t`Link copied.`)}>
            <Trans>Copy only the link</Trans>
          </Button>
          <details class="howto-fold">
            <summary>
              <span>
                <Trans>View accompanying text</Trans>
              </span>
              <Icon name="chevron" size={18} />
            </summary>
            <p class="small" style={{ whiteSpace: "pre-wrap" }}>
              {message}
            </p>
          </details>
          <div class="btn-row">
            <Button size="sm" variant="ghost" icon="refresh" onClick={create}>
              <Trans>New link</Trans>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={async () => {
                if (!(await confirmDialog({ title: t`Withdraw link?`, message: t`The link will stop working afterwards. Existing access remains.`, confirmLabel: t`Withdraw`, danger: true }))) return;
                await api.del(`/invites/${invite.id}`);
                props.onChanged();
              }}
            >
              <Trans>Withdraw</Trans>
            </Button>
          </div>
        </>
      ) : (
        <Button variant="primary" icon="link" onClick={create}>
          <Trans>Create link</Trans>
        </Button>
      )}
    </section>
  );
}

function InvitesTab({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const names = team.duplicateNames.join(", ");
  const teamName = team.name;
  return (
    <>
      <Notice>
        <Trans>
          Only share the links in the team's private WhatsApp group or show the QR code directly. Links expire after 14 days. In the squad overview you can see
          who is linked and remove wrong links.
        </Trans>
      </Notice>
      {team.duplicateNames.length ? (
        <Notice kind="warn">
          <Trans>Before sharing, please add the last names where first names are the same ({names}).</Trans>
        </Notice>
      ) : null}
      <ReachOverview team={team} />
      <InviteCard team={team} kind="player" invite={team.invites.player} onChanged={onChanged} />
      {team.parentsEnabled ? (
        <InviteCard team={team} kind="parent" invite={team.invites.parent} onChanged={onChanged} />
      ) : (
        <Notice>
          <Trans>
            Parents are not included in {teamName}. The players accept and decline themselves and are on their own in the chat. An admin can change this under
            Administration, Teams.
          </Trans>
        </Notice>
      )}
      <p class="small muted">
        <Trans>Lost device or new passkey: open the person in the squad overview and create a personal one-time link.</Trans>
      </p>
    </>
  );
}

/** Who cannot be reached yet: no access at all (neither own nor parents'), or no notifications. */
function ReachOverview({ team }: { team: TeamDetail }) {
  const players = team.players.filter((p) => p.isActive);
  const unreachable = players.filter((p) => !p.hasAccount && !p.guardians.some((g) => g.hasAccount));
  const noPush = players.filter((p) => (p.hasAccount || p.guardians.some((g) => g.hasAccount)) && !p.hasPush && !p.guardians.some((g) => g.hasPush));
  if (!unreachable.length && !noPush.length) {
    return (
      <Notice kind="info" icon="check">
        <Trans>Everyone in the squad can be reached with notifications.</Trans>
      </Notice>
    );
  }
  const names = (list: typeof players) => list.map((p) => personName(p.person)).join(", ");
  const without = names(unreachable);
  const quiet = names(noPush);
  const withoutCount = unreachable.length;
  const quietCount = noPush.length;
  return (
    <section class="card card-pad stack-sm" aria-label={t`Reachability`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Not reached yet</Trans>
      </h2>
      {unreachable.length ? (
        <p class="small">
          <strong>{plural(withoutCount, { one: "# without access", other: "# without access" })}:</strong> {without}
        </p>
      ) : null}
      {noPush.length ? (
        <p class="small">
          <strong>{plural(quietCount, { one: "# without notifications", other: "# without notifications" })}:</strong> {quiet}
        </p>
      ) : null}
      <p class="small muted">
        <Trans>
          Without notifications people only see changes when they open the app. The guide under help shows how to switch them on. Parents count for their child.
        </Trans>
      </p>
    </section>
  );
}

function SettingsTab({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const { refresh: refreshSession } = useSession();
  const [training, setTraining] = useState(String(team.declineHoursTraining));
  const [game, setGame] = useState(String(team.declineHoursGame));
  const [maxSquad, setMaxSquad] = useState(String(team.maxSquad));
  const [portal, setPortal] = useState("");
  const dutiesOn = useModule("duties");
  const fixturesOn = useModule("handball4all");
  const h4aSet = team.h4a.orgId != null;
  const orgId = team.h4a.orgId ?? "";
  const leagueId = team.h4a.leagueId ?? "";
  const teamId = team.h4a.teamId ?? "";
  const importedDate = team.h4a.importedAt ? fullDate(isoToLocalDate(team.h4a.importedAt)) : "";
  return (
    <>
      <section class="card card-body" aria-label={t`Decline deadlines`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Decline deadlines</Trans>
        </h2>
        <p class="muted small">
          <Trans>Up to how many hours before the start can players decline without a note? Later declines are possible but count as short notice.</Trans>
        </p>
        <div class="grid-2">
          <TextField label={t`Training (hrs)`} value={training} onInput={setTraining} inputMode="numeric" maxLength={3} />
          <TextField label={t`Game (hrs)`} value={game} onInput={setGame} inputMode="numeric" maxLength={3} />
        </div>
        <TextField label={t`Maximum squad size`} value={maxSquad} onInput={setMaxSquad} inputMode="numeric" maxLength={2} />
        <Button
          variant="primary"
          onClick={async () => {
            const values = [training, game, maxSquad].map(Number);
            if (values.some((v) => !Number.isInteger(v) || v < 0) || values[2]! < 1 || values[0]! > 168 || values[1]! > 168) {
              toast(t`Please enter valid numbers (deadlines 0 to 168 hours).`, "error");
              return;
            }
            await api.patch(`/teams/${team.id}`, { declineHoursTraining: values[0], declineHoursGame: values[1], maxSquad: values[2] });
            invalidate("/events");
            toast(t`Saved.`);
            onChanged();
          }}
        >
          <Trans>Save</Trans>
        </Button>
      </section>

      <section class="card card-body" aria-label={t`Squad`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Squad for games</Trans>
        </h2>
        <SwitchRow
          label={t`Automatically nominate the core squad for all games`}
          sub={t`Saves nominating for every game. Changes for individual games remain possible. Instead of a push about the nomination, a reminder comes three days before each game.`}
          checked={team.autoSquad}
          onChange={async (value) => {
            await api.patch(`/teams/${team.id}`, { autoSquad: value });
            invalidate("/events");
            toast(value ? t`The core squad is now nominated for all future games.` : t`Automatic squad switched off. Squads already nominated remain.`);
            onChanged();
          }}
        />
      </section>

      <section class="card card-body" aria-label={t`Responses`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Responses</Trans>
        </h2>
        <SwitchRow
          label={t`Responses visible to everyone`}
          sub={t`For training and special events, players (and included parents) see who has accepted or declined. Reasons remain visible to coaches only. Better left off for youth teams, so that nobody is swayed by others declining.`}
          checked={team.showResponses}
          onChange={async (value) => {
            await api.patch(`/teams/${team.id}`, { showResponses: value });
            invalidate("/events");
            toast(value ? t`Responses are now visible to everyone.` : t`Responses are now visible to coaches only.`);
            onChanged();
          }}
        />
      </section>

      {dutiesOn ? (
      <section class="card card-body" aria-label={t`Helper plan`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Helper plan</Trans>
        </h2>
        <SwitchRow
          label={t`Helper plan for this team`}
          sub={
            team.parentsEnabled
              ? t`Parents sign up for duties at games, such as cake & bar or jerseys ("Helpers" tab).`
              : t`The players sign up for duties at games themselves ("Helpers" tab).`
          }
          checked={team.helperPlan}
          onChange={async (value) => {
            await api.patch(`/teams/${team.id}`, { helperPlan: value });
            invalidate("/duties");
            void refreshSession();
            toast(value ? t`Helper plan switched on.` : t`Helper plan switched off. Entries are kept.`);
            onChanged();
          }}
        />
        {team.helperPlan ? <TemplateChoice team={team} onChanged={onChanged} /> : null}
      </section>
      ) : null}

      {fixturesOn ? (
      <section class="card card-body" aria-label={t`Game schedule`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Game schedule (handball4all)</Trans>
        </h2>
        {h4aSet ? (
          <p>
            <Trans>
              Linked: association {orgId}, league {leagueId}, team {teamId}.
            </Trans>
            {team.h4a.importedAt ? " " + t`Last synced on ${importedDate}.` : " " + t`Not synced yet.`}
          </p>
        ) : (
          <p class="muted">
            <Trans>Not linked yet.</Trans>
          </p>
        )}
        {team.h4a.error ? <p class="small warn-text">{team.h4a.error}</p> : null}
        <Field
          label={t`Link from the handball4all portal`}
          hint={t`Open the team in the portal and paste the link from the address bar. It contains ogId, lId and tId.`}
        >
          {(id) => (
            <input
              id={id}
              class="input"
              type="url"
              value={portal}
              placeholder="https://www.handball4all.de/home/portal/…#/league?ogId=…"
              onInput={(e) => setPortal((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
        <div class="btn-row">
          <Button
            variant="primary"
            disabled={!portal.trim()}
            onClick={async () => {
              await api.put(`/teams/${team.id}/games/source`, { portalUrl: portal.trim() });
              setPortal("");
              toast(t`Linked. Use "Sync now" to fetch the game schedule.`);
              invalidate(`/teams/${team.id}`);
              onChanged();
            }}
          >
            <Trans>Link schedule</Trans>
          </Button>
          {h4aSet ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await api.put(`/teams/${team.id}/games/source`, { portalUrl: null });
                onChanged();
              }}
            >
              <Trans>Unlink schedule</Trans>
            </Button>
          ) : null}
        </div>
        {h4aSet ? <SourceBar team={{ id: team.id, name: team.name }} /> : null}
        <p class="small muted">
          <Trans>Syncing only happens at the press of a button, on a coach's or admin's device. handball4all only allows individual requests, so never automatically.</Trans>
        </p>
      </section>
      ) : null}

      <section class="card card-body" aria-label={t`Import games`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Import games from a table</Trans>
        </h2>
        <GameImport teamId={team.id} />
      </section>
    </>
  );
}

// Person (coach view) ----------------------------------------------------------------

export function PersonPage({ id, personId }: { id: string; personId: string }) {
  const { data: team, error, reload } = useQuery<TeamDetail>(`/teams/${id}`);
  const player = team?.players.find((p) => String(p.person.id) === personId) ?? null;
  const helper = team?.helpers.find((h) => String(h.person.id) === personId) ?? null;
  const person = player?.person ?? helper?.person ?? null;
  useDocumentTitle(person ? personName(person) : t`Person`);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [year, setYear] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string; for: string } | null>(null);

  useEffect(() => {
    if (!player) return;
    setFirst(player.person.firstName);
    setLast(player.person.lastName ?? "");
    setYear(player.birthYear ? String(player.birthYear) : "");
  }, [player?.person.id, player?.person.firstName, player?.person.lastName, player?.birthYear]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!team) return <Spinner />;
  const teamName = team.name;
  if (!person) {
    return (
      <main class="page">
        <TopBar title={t`Person`} back={`/team/${id}`} />
        <div class="content">
          <Notice kind="warn">
            <Trans>This person is not (or no longer) part of {teamName}.</Trans>
          </Notice>
        </div>
      </main>
    );
  }

  const refresh = () => {
    invalidate(`/teams/${id}`, "/events");
    void reload();
  };

  const createLink = async (targetId: number, label: string) => {
    const res = await api.post<{ url: string; expiresAt: string }>(`/persons/${targetId}/personal-link`, {});
    setLink({ ...res, for: label });
  };
  const firstName = person.firstName;
  const fullName = personName(person);
  const unexcused = (player ?? helper)?.unexcused ?? 0;
  const homeTeam = helper?.homeTeam;
  const linkFor = link?.for ?? "";
  const linkExpires = link ? fullDate(isoToLocalDate(link.expiresAt)) : "";

  return (
    <main class="page">
      <TopBar
        title={personName(person)}
        kicker={
          <Trans>
            Team <span class="nocaps">{teamName}</span>
          </Trans>
        }
        back={`/team/${id}`}
      />
      <div class="content">
        {(player ?? helper)?.unexcused ? (
          <Notice kind="warn">
            <Trans>
              Absent without excuse {unexcused}× this season. You can change this in the respective event under <a href="/?zeit=vergangen">Events → Past</a>.
            </Trans>
          </Notice>
        ) : null}
        {player ? (
          <>
            <section class="card card-body" aria-label={t`Personal data`}>
              <h2 class="section-title" style={{ margin: 0 }}>
                <Trans>Personal data</Trans>
              </h2>
              <TextField label={t`First name`} value={first} onInput={setFirst} maxLength={50} />
              <TextField label={t`Last name`} value={last} onInput={setLast} maxLength={50} />
              <TextField
                label={t`Birth year`}
                value={year}
                onInput={setYear}
                inputMode="numeric"
                maxLength={4}
                hint={player.ageWarning ?? t`The app stores no further data.`}
              />
              <Button
                variant="primary"
                disabled={!first.trim()}
                onClick={async () => {
                  const birthYear = year.trim() ? Number(year) : null;
                  if (birthYear != null && (!Number.isInteger(birthYear) || birthYear < 1930 || birthYear > 2100)) {
                    toast(t`Please enter a valid year of birth.`, "error");
                    return;
                  }
                  await api.patch(`/persons/${person.id}`, { firstName: first.trim(), lastName: last.trim() || null, birthYear });
                  toast(t`Saved.`);
                  refresh();
                }}
              >
                <Trans>Save</Trans>
              </Button>
            </section>
            <ul class="list">
              <li>
                <SwitchRow
                  label={t`Active`}
                  sub={player.isActive ? t`Takes part in events as usual.` : t`Inactive: all events count as absent, no reminders.`}
                  checked={player.isActive}
                  onChange={async (active) => {
                    await api.post(`/persons/${person.id}/active`, { active });
                    toast(active ? t`${firstName} is active again.` : t`${firstName} is inactive.`);
                    refresh();
                  }}
                />
              </li>
              <li>
                <SwitchRow
                  label={t`Core squad`}
                  checked={player.isCore}
                  onChange={async (core) => {
                    const ids = coreIds(team);
                    await api.put(`/teams/${team.id}/core-squad`, { personIds: core ? [...ids, person.id] : ids.filter((x) => x !== person.id) });
                    refresh();
                  }}
                />
              </li>
            </ul>
            <p class="small muted">
              <Trans>Inactive e.g. in case of injury, illness or a student exchange. The app deliberately stores no reason.</Trans>
            </p>
          </>
        ) : (
          <Notice>
            {homeTeam ? (
              <Trans>Stand-in from {homeTeam}. Their coach maintains the personal data.</Trans>
            ) : (
              <Trans>Stand-in from the other team. Their coach maintains the personal data.</Trans>
            )}
          </Notice>
        )}

        {player ? (
          <section class="card card-body" aria-label={t`Access`}>
            <h2 class="section-title" style={{ margin: 0 }}>
              <Trans>Access</Trans>
            </h2>
            <p>{player.hasAccount ? t`${firstName} has their own access.` : t`${firstName} does not have their own access yet.`}</p>
            {player.hasAccount ? (
              <p class="small muted">
                <Trans>The link signs out the previous devices, for example after losing a device.</Trans>
              </p>
            ) : null}
            <Button icon="link" onClick={() => createLink(person.id, person.firstName)}>
              {player.hasAccount ? t`Link for new passkey` : t`Personal invitation link`}
            </Button>
            {player.hasAccount ? (
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !(await confirmDialog({
                      title: t`Remove access?`,
                      message: t`The access of ${firstName} will be deleted, e.g. after a wrong selection with the player link. The person stays in the squad and can register again.`,
                      confirmLabel: t`Remove access`,
                      danger: true,
                    }))
                  )
                    return;
                  await api.del(`/persons/${person.id}/account`);
                  toast(t`Access removed.`);
                  refresh();
                }}
              >
                <Trans>Remove access</Trans>
              </Button>
            ) : null}
          </section>
        ) : null}

        {player ? (
          <section class="card card-body" aria-label={t`Parents`}>
            <h2 class="section-title" style={{ margin: 0 }}>
              <Trans>Parents</Trans>
            </h2>
            {!team!.parentsEnabled ? (
              <p class="muted">
                <Trans>Parents are not included in this team.</Trans>
              </p>
            ) : !player.guardians.length ? (
              <p class="muted">
                <Trans>No parents linked yet. Parents link themselves via the parent link.</Trans>
              </p>
            ) : null}
            {player.guardians.map((g) => (
              <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "10px" }}>
                <div class="row-gap" style={{ justifyContent: "space-between" }}>
                  <strong>{personName(g)}</strong>
                  <span class="small muted">{g.hasAccount ? t`with access` : t`without access`}</span>
                </div>
                <div class="btn-row">
                  <Button size="sm" icon="link" onClick={() => createLink(g.id, g.firstName)}>
                    <Trans>Link for new passkey</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const guardianName = personName(g);
                      if (
                        !(await confirmDialog({
                          title: t`Remove connection?`,
                          message: t`${guardianName} will then no longer be linked to ${firstName}. Parents without another child are deleted.`,
                          confirmLabel: t`Unlink`,
                          danger: true,
                        }))
                      )
                        return;
                      await api.del(`/guardianships/${g.id}/${person.id}`);
                      toast(t`Connection removed.`);
                      refresh();
                    }}
                  >
                    <Trans>Unlink</Trans>
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section class="stack-sm" aria-label={t`More actions`}>
          <Button
            variant="ghost"
            onClick={async () => {
              const role = player ? "player" : "helper";
              if (!(await confirmDialog({ title: t({ message: `Remove from ${teamName}?`, context: "team" }), message: t`${fullName} stays in the club but no longer belongs to ${teamName}.`, confirmLabel: t`Remove` }))) return;
              await api.del(`/teams/${team.id}/members/${person.id}?role=${role}`);
              invalidate(`/teams/${id}`, "/events");
              history.back();
            }}
          >
            <Trans>Remove from the team</Trans>
          </Button>
          {player ? (
            <Button
              variant="danger"
              icon="door"
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: t`Record leaving the club?`,
                    message: t`${fullName} can then no longer sign in and appears in the chat as "former player". Linked parents without another child are deactivated as well. All data is deleted at the next season change.`,
                    confirmLabel: t`Record leaving`,
                    danger: true,
                  }))
                )
                  return;
                await api.post(`/persons/${person.id}/leave`, {});
                toast(t`Leaving recorded.`);
                invalidate(`/teams/${id}`, "/events");
                history.back();
              }}
            >
              <Trans>Leaving the club</Trans>
            </Button>
          ) : null}
        </section>
      </div>
      {link ? (
        <Sheet open onClose={() => setLink(null)} title={t`Link for ${linkFor}`}>
          <p class="muted">
            <Trans>
              Personal one-time link, valid until {linkExpires}. Please pass it on directly to {linkFor} only.
            </Trans>
          </p>
          <QrLink url={link.url} />
          <div class="url-box">{link.url}</div>
          <div class="btn-row">
            <Button
              variant="primary"
              icon="share"
              onClick={() => {
                const club = clubName();
                return shareLink(club, t`Your personal access to the ${club} app`, link.url);
              }}
            >
              <Trans>Share</Trans>
            </Button>
            <Button icon="copy" onClick={() => copyText(link.url)}>
              <Trans>Copy</Trans>
            </Button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}


/** Helper duty template for home and away games (maintained club-wide, only chosen here). */
function TemplateChoice({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const templates = useQuery<{ templates: TemplateInfo[] }>("/duty-templates");
  const types = useQuery<{ types: DutyTypeInfo[] }>("/duty-types?all=1");
  const list = templates.data?.templates ?? [];
  const typeName = (id: number) => types.data?.types.find((t) => t.id === id)?.name ?? "?";
  const summary = (tpl: TemplateInfo | undefined) =>
    tpl ? tpl.items.map((i) => (i.slots > 1 ? `${typeName(i.dutyTypeId)} (${i.slots})` : typeName(i.dutyTypeId))).join(", ") || t`no duties` : "";
  const select = (field: "homeTemplateId" | "awayTemplateId", label: string, kind: "home" | "away") => {
    const fallback = list.find((t) => t.defaultFor === kind);
    const current = list.find((t) => t.id === team[field]) ?? fallback;
    return (
      <Field label={label} hint={summary(current)}>
        {(id) => (
          <select
            id={id}
            class="select"
            value={String(current?.id ?? "")}
            onChange={async (e) => {
              const value = Number((e.target as HTMLSelectElement).value);
              try {
                await api.patch(`/teams/${team.id}`, { [field]: value === fallback?.id ? null : value });
                invalidate("/duties");
                toast(t`Template saved. Upcoming games without entries get the new duties.`);
                onChanged();
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }}
          >
            {list.map((t) => (
              <option value={String(t.id)}>{t.name}</option>
            ))}
          </select>
        )}
      </Field>
    );
  };
  if (!list.length) return null;
  return (
    <div class="stack-sm">
      {select("homeTemplateId", t`Template for home games`, "home")}
      {select("awayTemplateId", t`Template for away games`, "away")}
      <p class="small muted">
        <Trans>
          Templates define which duties there are at every game, with slots and times. Admins maintain them under Administration → Helper duties. KiHaSL/JuHaSL
          is always added automatically for youth home games F to C.
        </Trans>
      </p>
    </div>
  );
}
