// Gruppen: nur Chat und Sondertermine (z. B. Trainerteam, KiHaSL/JuHaSL). Intern eine Mannschaft mit
// kind = 'group', siehe docs/entscheidungen.md, Abschnitt Gruppen.
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

/** Rollenbezeichnung: in Gruppen „Mitglied“ und „Verantwortlich“ statt Spieler und Trainer. */
export function roleLabel(role: string, isGroup: boolean): string {
  if (isGroup) return role === "coach" ? "Verantwortlich" : "Mitglied";
  return role === "coach" ? "Trainer" : role === "helper" ? "Aushilfe" : "Spieler";
}

/** Erklärt den Unterschied zwischen Gruppe und Mannschaft. */
export function GroupExplainer({ compact = false }: { compact?: boolean }) {
  return (
    <Notice>
      <strong>Gruppe oder Mannschaft?</strong> Eine Gruppe hat nur einen Chat und Sondertermine mit Zu- und Absage, etwa für das Trainerteam oder die
      KiHaSL/JuHaSL. Training, Spiele, Kader, Helferplan, Eltern und Altersklasse gibt es nur bei Mannschaften.
      {compact ? null : " Beim Saisonwechsel bleiben die Mitglieder einer Gruppe erhalten."}
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

/** Verwaltung → Gruppen. */
export function AdminGroupsPage() {
  useDocumentTitle("Gruppen");
  const me = useMe();
  const { refresh } = useSession();
  const { data, error, reload } = useQuery<{ teams: GroupListItem[] }>("/teams");
  const [create, setCreate] = useState<{ name: string; auto: "manual" | "referees" } | null>(null);
  const groups = (data?.teams ?? []).filter((t) => t.kind === "group");
  const hasRefereeGroup = groups.some((g) => g.autoMembers === "referees");
  if (!me.isAdmin) return <Empty title="Nur für Admins">Gruppen legen Admins an.</Empty>;
  return (
    <main class="page">
      <TopBar title="Gruppen" kicker="Verwaltung" back="/verwaltung" />
      <div class="content">
        <GroupExplainer />
        <Button variant="primary" icon="plus" onClick={() => setCreate({ name: "", auto: "manual" })}>
          Gruppe anlegen
        </Button>
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {!data ? <Spinner /> : null}
        {data && !groups.length ? <Empty title="Noch keine Gruppe">Lege eine Gruppe an, etwa für das Trainerteam.</Empty> : null}
        <ul class="list">
          {groups.map((g) => (
            <li>
              <a class="list-row" href={`/team/${g.id}`}>
                <span class="team-badge outline" style={{ minWidth: "48px", textAlign: "center" }}>
                  {g.name}
                </span>
                <span class="main">
                  <span class="title">{g.name}</span>
                  <span class="sub">
                    Gruppe · {g.players} {g.players === 1 ? "Mitglied" : "Mitglieder"} · {g.coaches} Verantwortliche
                    {g.autoMembers === "referees" ? " · automatisch alle KiHaSL/JuHaSL" : ""}
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          ))}
        </ul>
      </div>
      {create ? (
        <Sheet open onClose={() => setCreate(null)} title="Neue Gruppe">
          <p class="muted">Nur Chat und Sondertermine. Kein Training, keine Spiele, kein Kader, keine Eltern.</p>
          <TextField label="Name" value={create.name} onInput={(v) => setCreate({ ...create, name: v })} maxLength={30} hint="Kurz, erscheint wie ein Mannschaftsname, z. B. JT" />
          <Segmented<"manual" | "referees">
            label="Mitglieder"
            value={create.auto}
            onChange={(v) => setCreate({ ...create, auto: v, name: v === "referees" && !create.name ? "KiHaSL/JuHaSL" : create.name })}
            options={[
              { value: "manual", label: "Von Hand" },
              { value: "referees", label: "Alle KiHaSL/JuHaSL" },
            ]}
          />
          <p class="small muted">
            {create.auto === "referees"
              ? "Mitglieder sind automatisch alle Personen mit der Rolle KiHaSL/JuHaSL, Verantwortliche alle Admins. Kommt jemand dazu oder verliert die Rolle, passt sich die Gruppe an."
              : "Mitglieder und Verantwortliche ordnest du danach in der Gruppe zu."}
          </p>
          {create.auto === "referees" && hasRefereeGroup ? <Notice kind="warn">Es gibt schon eine Gruppe für alle KiHaSL/JuHaSL.</Notice> : null}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!create.name.trim()}
            onClick={async () => {
              const { id } = await api.post<{ id: number }>("/groups", { name: create.name.trim(), autoMembers: create.auto === "referees" ? "referees" : null });
              toast("Gruppe angelegt.");
              setCreate(null);
              invalidate("/teams", "/chat");
              await refresh();
              location.assign(`/team/${id}`);
            }}
          >
            Anlegen
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

/** Seite einer Gruppe: Mitglieder, Verantwortliche, Sondertermine, Einstellungen. */
export function GroupPage({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const me = useMe();
  const { refresh } = useSession();
  const [addRole, setAddRole] = useState<"player" | "coach" | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const auto = team.autoMembers === "referees";
  const manage = me.isAdmin && !auto;

  const remove = async (p: PersonRef, role: "player" | "coach") => {
    const ok = await confirmDialog({
      title: `Aus ${team.name} entfernen?`,
      message: `${personName(p)} ist danach nicht mehr ${roleLabel(role, true)} in der Gruppe ${team.name}. Die Person bleibt erhalten.`,
      confirmLabel: "Entfernen",
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
          <div class="kicker">Gruppe · nur Chat und Sondertermine</div>
          {me.isAdmin || me.manageableTeams.length > 1 ? (
            <a class="team-badge outline" href={me.isAdmin ? "/verwaltung/gruppen" : "/team"} style={{ textDecoration: "none" }}>
              Wechseln
            </a>
          ) : null}
        </div>
        <h1>{team.name}</h1>
        <div class="hero-sub">
          {team.players.length} {team.players.length === 1 ? "Mitglied" : "Mitglieder"} · {team.coaches.length} Verantwortliche
        </div>
      </header>
      <div class="content">
        <div class="grid-2">
          <a class="btn btn-primary" href={`/team/${team.id}/termin-neu`}>
            <Icon name="plus" size={18} />
            Sondertermin anlegen
          </a>
          <a class="btn" href={`/chat/${team.id}`}>
            <Icon name="chat" size={18} />
            Chat öffnen
          </a>
        </div>
        <GroupExplainer compact />
        <details class="card howto-fold faq">
          <summary>
            <span>Kommende Sondertermine</span>
            <Icon name="chevron" size={18} />
          </summary>
          <div class="card-body stack-sm">
            <p class="small muted">Antippen öffnet den Termin zum Bearbeiten, Absagen oder Löschen.</p>
            <ExtraEventList path={`/teams/${team.id}/extra-events`} empty="Noch keine kommenden Sondertermine." showTeams={false} />
          </div>
        </details>

        {auto ? (
          <Notice>Mitglieder sind automatisch alle Personen mit der Rolle KiHaSL/JuHaSL, Verantwortliche alle Admins. Die Rolle vergibst du unter Verwaltung → KiHaSL/JuHaSL.</Notice>
        ) : null}

        <section class="stack-sm" aria-label="Verantwortliche">
          <h2 class="section-title">Verantwortliche</h2>
          <p class="small muted">Legen Sondertermine an, erinnern und moderieren den Chat (auch @alle).</p>
          <MemberList members={team.coaches.map((c) => ({ person: c.person, hasAccount: c.hasAccount }))} onRemove={manage ? (p) => remove(p, "coach") : undefined} />
          {manage ? (
            <Button icon="plus" onClick={() => setAddRole("coach")}>
              Verantwortliche hinzufügen
            </Button>
          ) : null}
        </section>

        <section class="stack-sm" aria-label="Mitglieder">
          <h2 class="section-title">Mitglieder</h2>
          <MemberList members={team.players.map((p) => ({ person: p.person, hasAccount: p.hasAccount }))} onRemove={manage ? (p) => remove(p, "player") : undefined} />
          {manage ? (
            <Button icon="plus" onClick={() => setAddRole("player")}>
              Mitglieder hinzufügen
            </Button>
          ) : null}
          {!me.isAdmin && !auto ? <p class="small muted">Mitglieder ordnet ein Admin zu.</p> : null}
        </section>

        <section class="card card-body" aria-label="Einstellungen">
          <h2 class="section-title" style={{ marginTop: 0 }}>
            Rückmeldungen
          </h2>
          <SwitchRow
            label="Zu- und Absagen für alle sichtbar"
            sub="Bei Sonderterminen sehen alle Mitglieder, wer zu- oder abgesagt hat. Gründe sehen nur die Verantwortlichen."
            checked={team.showResponses}
            onChange={async (value) => {
              await api.patch(`/teams/${team.id}`, { showResponses: value });
              invalidate("/events");
              toast(value ? "Zu- und Absagen sind jetzt für alle sichtbar." : "Zu- und Absagen sehen jetzt nur die Verantwortlichen.");
              onChanged();
            }}
          />
        </section>

        {me.isAdmin ? (
          <div class="btn-row">
            <Button variant="ghost" icon="edit" onClick={() => setRenameOpen(true)}>
              Umbenennen
            </Button>
            <Button
              variant="ghost"
              icon="trash"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `Gruppe ${team.name} löschen?`,
                  message: "Chat und Sondertermine der Gruppe werden gelöscht. Die Personen bleiben erhalten.",
                  confirmLabel: "Löschen",
                  danger: true,
                });
                if (!ok) return;
                await api.del(`/teams/${team.id}`);
                invalidate("/teams", "/chat", "/events");
                await refresh();
                location.assign("/verwaltung/gruppen");
              }}
            >
              Gruppe löschen
            </Button>
          </div>
        ) : null}

        {!me.isAdmin ? (
          <ul class="list">
            <li>
              <a class="list-row" href="/hilfe">
                <Icon name="info" size={22} />
                <span class="main">
                  <span class="title">Hilfe und Feedback</span>
                  <span class="sub">Häufige Fragen, Anleitungen, Rückmeldung zur App</span>
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
  if (!members.length) return <p class="small muted">Noch niemand.</p>;
  return (
    <ul class="list">
      {members.map((m) => (
        <li class="list-row">
          <span class="main">
            <span class="title">{personName(m.person)}</span>
            <span class="sub">{m.hasAccount ? "nutzt die App" : "noch kein Zugang"}</span>
          </span>
          {onRemove ? (
            <Button size="sm" variant="ghost" onClick={() => onRemove(m.person)}>
              Entfernen
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
  const candidates = (persons.data?.persons ?? []).filter(
    (p) => !inGroup.has(p.person.id) && (!filter || personName(p.person).toLowerCase().includes(filter.toLowerCase())),
  );
  return (
    <Sheet open onClose={onClose} title={role === "coach" ? `Verantwortliche ${team.name}` : `Mitglieder ${team.name}`}>
      <TextField label="Person suchen" value={filter} onInput={setFilter} placeholder="Name" />
      {!persons.data ? <Spinner /> : null}
      <ul class="list" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {candidates.slice(0, 40).map((p) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(p.person)}</span>
              <span class="sub">
                {p.teams.map((t) => `${t.name} (${roleLabel(t.role, t.isGroup)})`).join(", ") || (p.children ? `Elternteil von ${p.children}` : "ohne Mannschaft")}
              </span>
            </span>
            <Button
              size="sm"
              onClick={async () => {
                await api.post(`/teams/${team.id}/members`, { personId: p.person.id, role });
                toast(`${p.person.firstName} ist jetzt ${roleLabel(role, true)} in ${team.name}.`);
                invalidate("/admin/persons", "/teams");
                await persons.reload();
                await refresh();
                onChanged();
              }}
            >
              Hinzufügen
            </Button>
          </li>
        ))}
      </ul>
      <p class="small muted">Neue Personen zuerst unter Verwaltung → Personen anlegen.</p>
    </Sheet>
  );
}

function RenameSheet({ team, onClose, onChanged }: { team: TeamDetail; onClose: () => void; onChanged: () => void }) {
  const { refresh } = useSession();
  const [name, setName] = useState(team.name);
  return (
    <Sheet open onClose={onClose} title="Gruppe umbenennen">
      <TextField label="Name" value={name} onInput={setName} maxLength={30} />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!name.trim() || name.trim() === team.name}
        onClick={async () => {
          await api.patch(`/teams/${team.id}`, { name: name.trim() });
          toast("Gespeichert.");
          invalidate("/teams", "/chat", "/events");
          await refresh();
          onClose();
          onChanged();
        }}
      >
        Speichern
      </Button>
    </Sheet>
  );
}
