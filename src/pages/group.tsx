// Groups: only chat and special events (e.g. coaching team, youth referees). Internally a team with
// kind = 'group', see docs/dev/design.md, Groups.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { PersonRef } from "../../shared/types";
import { api } from "../api";
import { personName } from "../format";
import { Icon } from "../icons";
import { ExtraEventList } from "../extra-events";
import { useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, Empty, ErrorBox, Notice, Segmented, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import type { TeamDetail } from "./team";

/** Role label: in groups "Member" and "Lead" instead of player and coach. */
export function roleLabel(role: string, isGroup: boolean): string {
  if (isGroup) return role === "coach" ? t`Lead` : t`Member`;
  return role === "coach" ? t`Coach` : role === "helper" ? t`Stand-in` : role === "staff" ? t({ message: "Staff", context: "team role" }) : t`Player`;
}

/** Explains the difference between a group and a team. */
export function GroupExplainer({ compact = false }: { compact?: boolean }) {
  return (
    <Notice>
      <Trans>
        <strong>Group or team?</strong> A group only has a chat and special events with responses, for example for the coaching team or the youth referees. Training, games, squad,
        helper plan and age group only exist for teams.
      </Trans>
      {compact ? null : ` ${t`At the season change the members of a group are kept.`}`}
    </Notice>
  );
}

interface GroupListItem {
  id: number;
  name: string;
  kind: "team" | "group";
  autoMembers: "referees" | null;
  players: number;
  coaches: number;
}

/** Admin → Groups. */
export function AdminGroupsPage() {
  useDocumentTitle(t`Groups`);
  const me = useMe();
  const { refresh } = useSession();
  const { data, error, reload } = useQuery<{ teams: GroupListItem[] }>("/teams");
  const [create, setCreate] = useState<{
    name: string;
    auto: "manual" | "referees";
  } | null>(null);
  const groups = (data?.teams ?? []).filter((tm) => tm.kind === "group");
  const hasRefereeGroup = groups.some((g) => g.autoMembers === "referees");
  if (!me.isAdmin)
    return (
      <Empty title={t`Admins only`}>
        <Trans>Admins create groups.</Trans>
      </Empty>
    );
  return (
    <main class="page">
      <TopBar title={t`Groups`} kicker={t`Administration`} back="/verwaltung" />
      <div class="content">
        <GroupExplainer />
        <Button variant="primary" icon="plus" onClick={() => setCreate({ name: "", auto: "manual" })}>
          <Trans>Create group</Trans>
        </Button>
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data ? <Spinner /> : null}
        {data && !groups.length ? (
          <Empty title={t`No group yet`}>
            <Trans>Create a group, for example for the coaching team.</Trans>
          </Empty>
        ) : null}
        <ul class="list">
          {groups.map((g) => {
            const players = g.players;
            const coaches = g.coaches;
            const members = plural(players, {
              one: "# member",
              other: "# members",
            });
            const leads = plural(coaches, {
              one: "# lead",
              other: "# leads",
            });
            return (
              <li>
                <a class="list-row" href={`/team/${g.id}`}>
                  <span class="team-badge outline" style={{ minWidth: "48px", textAlign: "center" }}>
                    {g.name}
                  </span>
                  <span class="main">
                    <span class="title">{g.name}</span>
                    <span class="sub">
                      <Trans>
                        Group · {members} · {leads}
                      </Trans>
                      {g.autoMembers === "referees" ? ` · ${t`automatically all youth referees`}` : ""}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      {create ? (
        <Sheet open onClose={() => setCreate(null)} title={t`New group`}>
          <p class="muted">
            <Trans>Only chat and special events. No training, no games, no squad.</Trans>
          </p>
          <TextField label={t`Name`} value={create.name} onInput={(v) => setCreate({ ...create, name: v })} maxLength={30} hint={t`Short, shown like a team name, e.g. JT`} />
          <Segmented<"manual" | "referees">
            label={t`Members`}
            value={create.auto}
            onChange={(v) =>
              setCreate({
                ...create,
                auto: v,
                name: v === "referees" && !create.name ? t`Youth referees` : create.name,
              })
            }
            options={[
              { value: "manual", label: t`Manually` },
              { value: "referees", label: t`All youth referees` },
            ]}
          />
          <p class="small muted">
            {create.auto === "referees"
              ? t`Members are automatically all people with the youth referee role, leads all admins. If someone joins or loses the role, the group adjusts.`
              : t`You assign members and leads in the group afterwards.`}
          </p>
          {create.auto === "referees" && hasRefereeGroup ? (
            <Notice kind="warn">
              <Trans>There is already a group for all youth referees.</Trans>
            </Notice>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!create.name.trim()}
            onClick={async () => {
              const { id } = await api.post<{ id: number }>("/groups", {
                name: create.name.trim(),
                autoMembers: create.auto === "referees" ? "referees" : null,
              });
              toast(t`Group created.`);
              setCreate(null);
              invalidate("/teams", "/chat");
              await refresh();
              location.assign(`/team/${id}`);
            }}
          >
            <Trans>Create</Trans>
          </Button>
        </Sheet>
      ) : null}
    </main>
  );
}

interface AdminPersonLite {
  person: PersonRef;
  hasAccount: boolean;
  teams: { name: string; role: string; isGroup: boolean }[];
  children: string | null;
}

/** Page of a group: members, leads, special events, settings. */
export function GroupPage({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const me = useMe();
  const { refresh } = useSession();
  const [addRole, setAddRole] = useState<"player" | "coach" | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const auto = team.autoMembers === "referees";
  const manage = me.isAdmin && !auto;
  const teamName = team.name;
  const players = team.players.length;
  const coaches = team.coaches.length;

  const remove = async (p: PersonRef, role: "player" | "coach") => {
    const name = personName(p);
    const ok = await confirmDialog({
      title: t`Remove from group ${teamName}?`,
      message:
        role === "coach"
          ? t`${name} will then no longer be a lead in the group ${teamName}. The person is kept.`
          : t`${name} will then no longer be a member in the group ${teamName}. The person is kept.`,
      confirmLabel: t`Remove`,
      danger: true,
    });
    if (!ok) return;
    await api.del(`/teams/${team.id}/members/${p.id}?role=${role}`);
    invalidate("/teams", "/admin/persons");
    onChanged();
  };

  return (
    <main class="page">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">
            <Trans>Group · chat and special events only</Trans>
          </div>
          {me.isAdmin || me.manageableTeams.length > 1 ? (
            <a class="team-badge outline" href={me.isAdmin ? "/verwaltung/gruppen" : "/team"} style={{ textDecoration: "none" }}>
              <Trans>Switch</Trans>
            </a>
          ) : null}
        </div>
        <h1>{team.name}</h1>
        <div class="hero-sub">
          {plural(players, { one: "# member", other: "# members" })} · {plural(coaches, { one: "# lead", other: "# leads" })}
        </div>
      </header>
      <div class="content">
        <div class="grid-2">
          <a class="btn btn-primary" href={`/team/${team.id}/termin-neu`}>
            <Icon name="plus" size={18} />
            <Trans>Create special event</Trans>
          </a>
          <a class="btn" href={`/chat/${team.id}`}>
            <Icon name="chat" size={18} />
            <Trans>Open chat</Trans>
          </a>
        </div>
        <GroupExplainer compact />
        <details class="card howto-fold faq">
          <summary>
            <span>
              <Trans>Upcoming special events</Trans>
            </span>
            <Icon name="chevron" size={18} />
          </summary>
          <div class="card-body stack-sm">
            <p class="small muted">
              <Trans>Tap an event to edit, cancel or delete it.</Trans>
            </p>
            <ExtraEventList path={`/teams/${team.id}/extra-events`} empty={t`No upcoming special events yet.`} showTeams={false} />
          </div>
        </details>

        {auto ? (
          <Notice>
            <Trans>Members are automatically all people with the youth referee role, leads all admins. You give the role under Admin → Youth referees.</Trans>
          </Notice>
        ) : null}

        <section class="stack-sm" aria-label={t`Leads`}>
          <h2 class="section-title">
            <Trans>Leads</Trans>
          </h2>
          <p class="small muted">
            <Trans>Create special events, send reminders and moderate the chat (including @alle).</Trans>
          </p>
          <MemberList
            members={team.coaches.map((c) => ({
              person: c.person,
              hasAccount: c.hasAccount,
            }))}
            onRemove={manage ? (p) => remove(p, "coach") : undefined}
          />
          {manage ? (
            <Button icon="plus" onClick={() => setAddRole("coach")}>
              <Trans>Add leads</Trans>
            </Button>
          ) : null}
        </section>

        <section class="stack-sm" aria-label={t`Members`}>
          <h2 class="section-title">
            <Trans>Members</Trans>
          </h2>
          <MemberList
            members={team.players.map((p) => ({
              person: p.person,
              hasAccount: p.hasAccount,
            }))}
            onRemove={manage ? (p) => remove(p, "player") : undefined}
          />
          {manage ? (
            <Button icon="plus" onClick={() => setAddRole("player")}>
              <Trans>Add members</Trans>
            </Button>
          ) : null}
          {!me.isAdmin && !auto ? (
            <p class="small muted">
              <Trans>An admin assigns members.</Trans>
            </p>
          ) : null}
        </section>

        <section class="card card-body" aria-label={t`Settings`}>
          <h2 class="section-title" style={{ marginTop: 0 }}>
            <Trans>Responses</Trans>
          </h2>
          <SwitchRow
            label={t`Responses visible to everyone`}
            sub={t`For special events, all members see who accepted or declined. Only the leads see the reasons.`}
            checked={team.showResponses}
            onChange={async (value) => {
              await api.patch(`/teams/${team.id}`, { showResponses: value });
              invalidate("/events");
              toast(value ? t`Responses are now visible to everyone.` : t`Only the leads now see the responses.`);
              onChanged();
            }}
          />
          {me.isAdmin && !auto ? (
            <h2 class="section-title">
              <Trans>Parents</Trans>
            </h2>
          ) : null}
          {me.isAdmin && !auto ? (
            <SwitchRow
              label={t`Include parents`}
              sub={t`For a youth group: linked parents see the group's special events for their child, respond for it and are in the chat. Parents are linked through the child's team; groups have no parent links.`}
              checked={team.parentsEnabled}
              onChange={async (value) => {
                if (!value) {
                  const ok = await confirmDialog({
                    title: t`Continue without parents?`,
                    message: t`Parents will then no longer see this group's special events and chat and can no longer respond for their child. The links between parents and children are kept.`,
                    confirmLabel: t`Without parents`,
                  });
                  if (!ok) return;
                }
                await api.patch(`/teams/${team.id}`, { parentsEnabled: value });
                invalidate("/teams", "/events", "/chat");
                toast(value ? t`Parents are now included in this group.` : t`This group is now without parents.`);
                onChanged();
              }}
            />
          ) : null}
        </section>

        {me.isAdmin ? (
          <div class="btn-row">
            <Button variant="ghost" icon="edit" onClick={() => setRenameOpen(true)}>
              <Trans>Rename</Trans>
            </Button>
            <Button
              variant="ghost"
              icon="trash"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t`Delete group ${teamName}?`,
                  message: t`The group's chat and special events are deleted. The people are kept.`,
                  confirmLabel: t`Delete`,
                  danger: true,
                });
                if (!ok) return;
                await api.del(`/teams/${team.id}`);
                invalidate("/teams", "/chat", "/events");
                await refresh();
                location.assign("/verwaltung/gruppen");
              }}
            >
              <Trans>Delete group</Trans>
            </Button>
          </div>
        ) : null}

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
                    <Trans>Frequent questions, guides, feedback on the app</Trans>
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          </ul>
        ) : null}
      </div>
      {addRole ? <AddMembersSheet team={team} role={addRole} onClose={() => setAddRole(null)} onChanged={onChanged} /> : null}
      {renameOpen ? <RenameSheet team={team} onClose={() => setRenameOpen(false)} onChanged={onChanged} /> : null}
    </main>
  );
}

function MemberList({ members, onRemove }: { members: { person: PersonRef; hasAccount: boolean }[]; onRemove?: (p: PersonRef) => void }) {
  if (!members.length)
    return (
      <p class="small muted">
        <Trans>No one yet.</Trans>
      </p>
    );
  return (
    <ul class="list">
      {members.map((m) => (
        <li class="list-row">
          <span class="main">
            <span class="title">{personName(m.person)}</span>
            <span class="sub">{m.hasAccount ? t`uses the app` : t`no access yet`}</span>
          </span>
          {onRemove ? (
            <Button size="sm" variant="ghost" onClick={() => onRemove(m.person)}>
              <Trans>Remove</Trans>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AddMembersSheet({ team, role, onClose, onChanged }: { team: TeamDetail; role: "player" | "coach"; onClose: () => void; onChanged: () => void }) {
  const { refresh } = useSession();
  const persons = useQuery<{ persons: AdminPersonLite[] }>("/admin/persons");
  const [filter, setFilter] = useState("");
  const inGroup = new Set((role === "coach" ? team.coaches : team.players).map((m) => m.person.id));
  const candidates = (persons.data?.persons ?? []).filter((p) => !inGroup.has(p.person.id) && (!filter || personName(p.person).toLowerCase().includes(filter.toLowerCase())));
  const teamName = team.name;
  return (
    <Sheet open onClose={onClose} title={role === "coach" ? t`Leads of ${teamName}` : t`Members of ${teamName}`}>
      <TextField label={t`Search person`} value={filter} onInput={setFilter} placeholder={t`Name`} />
      {!persons.data ? <Spinner /> : null}
      <ul class="list" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {candidates.slice(0, 40).map((p) => {
          const children = p.children;
          return (
            <li class="list-row">
              <span class="main">
                <span class="title">{personName(p.person)}</span>
                <span class="sub">{p.teams.map((tm) => `${tm.name} (${roleLabel(tm.role, tm.isGroup)})`).join(", ") || (children ? t`Parent of ${children}` : t`no team`)}</span>
              </span>
              <Button
                size="sm"
                onClick={async () => {
                  await api.post(`/teams/${team.id}/members`, {
                    personId: p.person.id,
                    role,
                  });
                  const name = p.person.firstName;
                  toast(role === "coach" ? t`${name} is now a lead in ${teamName}.` : t`${name} is now a member in ${teamName}.`);
                  invalidate("/admin/persons", "/teams");
                  await persons.reload();
                  await refresh();
                  onChanged();
                }}
              >
                <Trans>Add</Trans>
              </Button>
            </li>
          );
        })}
      </ul>
      <p class="small muted">
        <Trans>Create new people first under Admin → People.</Trans>
      </p>
    </Sheet>
  );
}

function RenameSheet({ team, onClose, onChanged }: { team: TeamDetail; onClose: () => void; onChanged: () => void }) {
  const { refresh } = useSession();
  const [name, setName] = useState(team.name);
  return (
    <Sheet open onClose={onClose} title={t`Rename group`}>
      <TextField label={t`Name`} value={name} onInput={setName} maxLength={30} />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!name.trim() || name.trim() === team.name}
        onClick={async () => {
          await api.patch(`/teams/${team.id}`, { name: name.trim() });
          toast(t`Saved.`);
          invalidate("/teams", "/chat", "/events");
          await refresh();
          onClose();
          onChanged();
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </Sheet>
  );
}
