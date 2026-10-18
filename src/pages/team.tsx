import { clubName } from "../club";
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
  /** Gruppe: nur Chat und Sondertermine (src/pages/group.tsx). */
  kind: "team" | "group";
  autoMembers: "referees" | null;
  ageClassCode: string;
  ageClassName: string;
  level: number;
  /** Eltern sind eingebunden (Einstellung des Admins). */
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
  players: {
    person: PersonRef;
    birthYear: number | null;
    isActive: boolean;
    hasAccount: boolean;
    isCore: boolean;
    /** Wie oft in dieser Saison unentschuldigt gefehlt */
    unexcused: number;
    ageWarning: string | null;
    guardians: { id: number; firstName: string; lastName: string | null; hasAccount: boolean }[];
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
  useDocumentTitle("Team");
  const me = useMe();
  const { route } = useLocation();
  useEffect(() => {
    if (me.manageableTeams.length === 1) route(`/team/${me.manageableTeams[0]!.id}`, true);
  }, []);
  return (
    <main class="page">
      <TopBar title={me.manageableTeams.some((t) => me.groupIds.includes(t.id)) ? "Mannschaften und Gruppen" : "Meine Mannschaften"} kicker="Team" />
      <div class="content">
        {!me.manageableTeams.length ? <Empty title="Keine Mannschaft">Du bist bei keiner Mannschaft als Trainer eingetragen.</Empty> : null}
        <ul class="list">
          {me.manageableTeams.map((t) => (
            <li>
              <a class="list-row" href={`/team/${t.id}`}>
                <span class="team-badge">{t.name}</span>
                <span class="main">
                  <span class="title">{t.name}</span>
                  {me.groupIds.includes(t.id) ? <span class="sub">Gruppe · nur Chat und Sondertermine</span> : null}
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
  useDocumentTitle(team ? `Team ${team.name}` : "Team");
  useEffect(() => sessionStorage.setItem(`team-tab-${id}`, tab), [tab]);

  if (loading) return <Spinner />;
  if (error || !team) {
    return (
      <main class="page">
        <TopBar title="Team" back="/" />
        <div class="content">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      </main>
    );
  }
  if (team.kind === "group") return <GroupPage team={team} onChanged={reload} />;
  return (
    <main class="page">
      <header class="hero">
        <div class="hero-top">
          <div class="kicker">
            {team.ageClassName}
            {team.level > 1 ? ` · ${team.level}. Mannschaft` : ""}
          </div>
          {me.isAdmin || me.manageableTeams.length > 1 ? (
            <a class="team-badge outline" href={me.isAdmin ? "/verwaltung/mannschaften" : "/team"} style={{ textDecoration: "none" }}>
              Wechseln
            </a>
          ) : null}
        </div>
        <h1>Team {team.name}</h1>
        <div class="hero-sub">
          {team.players.length} Spieler · {team.players.filter((p) => p.hasAccount || p.guardians.some((g) => g.hasAccount)).length} erreichbar über die App
        </div>
      </header>
      <div class="content">
        <div class="grid-2">
          <a class="btn btn-primary" href={`/team/${team.id}/plaene`}>
            <Icon name="calendar" size={18} />
            Trainingspläne
          </a>
          <a class="btn" href={`/team/${team.id}/termin-neu`}>
            <Icon name="plus" size={18} />
            Termin anlegen
          </a>
        </div>
        <details class="card howto-fold faq">
          <summary>
            <span>Sondertermine und eigene Spiele</span>
            <Icon name="chevron" size={18} />
          </summary>
          <div class="card-body stack-sm">
            <p class="small muted">Kommende, von Hand angelegte Termine. Antippen öffnet den Termin zum Bearbeiten, Absagen oder Löschen.</p>
            <ExtraEventList path={`/teams/${team.id}/extra-events`} empty="Noch keine kommenden Sondertermine oder Spiele ohne handball4all." showTeams={false} />
          </div>
        </details>
        <Segmented<Tab>
          label="Bereich"
          value={tab}
          onChange={setTab}
          options={[
            { value: "kader", label: "Kader" },
            { value: "einladungen", label: "Einladungen" },
            { value: "einstellungen", label: "Einstellungen" },
          ]}
        />
        {tab === "kader" ? <RosterTab team={team} onChanged={reload} /> : null}
        {tab === "einladungen" ? <InvitesTab team={team} onChanged={reload} /> : null}
        {tab === "einstellungen" ? <SettingsTab team={team} onChanged={reload} /> : null}
        {/* Trainer haben keinen Reiter Hilfe; Admins finden sie unter Verwaltung */}
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
    </main>
  );
}

/** Stammkader: Spieler und dauerhafte Aushilfen. */
function coreIds(team: TeamDetail): number[] {
  return [...team.players, ...team.helpers].filter((p) => p.isCore).map((p) => p.person.id);
}

function RosterTab({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [coreOpen, setCoreOpen] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  return (
    <>
      {team.duplicateNames.length ? (
        <Notice kind="warn">
          Gleiche Namen im Kader: <strong>{team.duplicateNames.join(", ")}</strong>. Bitte ergänze die Nachnamen, bevor du den Spielerlink teilst, sonst ist die Auswahl
          nicht eindeutig.
        </Notice>
      ) : null}
      {team.missingLastNames || team.missingBirthYears ? (
        <Notice>
          {team.missingLastNames ? `${team.missingLastNames} ohne Nachnamen` : ""}
          {team.missingLastNames && team.missingBirthYears ? ", " : ""}
          {team.missingBirthYears ? `${team.missingBirthYears} ohne Geburtsjahr` : ""}. Tippe auf eine Person, um es zu ergänzen.
        </Notice>
      ) : null}

      <section class="stack-sm" aria-label="Spielerinnen und Spieler">
        <div class="row-gap" style={{ justifyContent: "space-between" }}>
          <h2 class="section-title">Spieler · {team.players.length}</h2>
          <Button size="sm" icon="plus" onClick={() => setAddOpen(true)}>
            Hinzufügen
          </Button>
        </div>
        {!team.players.length ? <Empty title="Noch niemand im Kader">Lege zuerst die Spielerinnen und Spieler an.</Empty> : null}
        <ul class="list">
          {team.players.map((p) => (
            <li>
              <a class="list-row" href={`/team/${team.id}/person/${p.person.id}`}>
                <PersonAvatar personId={p.person.id} name={p.person.firstName} />
                <span class="main">
                  <span class="title" style={{ color: p.isActive ? undefined : "var(--text-2)" }}>
                    {personName(p.person)} {p.isCore ? <span class="badge outline">Stamm</span> : null} {!p.isActive ? <span class="badge muted">Inaktiv</span> : null}{" "}
                    {p.unexcused ? <span class="badge warn">{p.unexcused}× unentschuldigt</span> : null}
                  </span>
                  <span class="sub">
                    {p.birthYear ? `Jg. ${p.birthYear}` : "Jahrgang fehlt"} · {p.hasAccount ? "eigener Zugang" : "kein eigener Zugang"}
                    {p.guardians.length ? ` · Eltern: ${p.guardians.map((g) => `${g.firstName}${g.hasAccount ? "" : " (ohne Zugang)"}`).join(", ")}` : ""}
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
            Stammkader festlegen
          </Button>
        ) : null}
      </section>

      <section class="stack-sm" aria-label="Aushilfen">
        <div class="row-gap" style={{ justifyContent: "space-between" }}>
          <h2 class="section-title">Aushilfen · {team.helpers.length}</h2>
          <Button size="sm" icon="plus" onClick={() => setHelperOpen(true)}>
            Hinzufügen
          </Button>
        </div>
        {team.helpers.length ? (
          <ul class="list">
            {team.helpers.map((h) => (
              <li>
                <div class="list-row">
                  <span class="main">
                    <span class="title">
                      {personName(h.person)} {h.isCore ? <span class="badge outline">Stamm</span> : null}{" "}
                      {h.unexcused ? <span class="badge warn">{h.unexcused}× unentschuldigt</span> : null}
                    </span>
                    <span class="sub">aus der {h.homeTeam ?? "anderen Mannschaft"} · sieht Spiele</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${h.person.firstName} als Aushilfe entfernen`}
                    onClick={async () => {
                      if (!(await confirmDialog({ title: "Aushilfe entfernen?", message: `${personName(h.person)} ist dann keine dauerhafte Aushilfe der ${team.name} mehr.`, confirmLabel: "Entfernen" }))) return;
                      await api.del(`/teams/${team.id}/members/${h.person.id}?role=helper`);
                      onChanged();
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </Button>
                </div>
                <SwitchRow
                  label="Sieht auch Trainings"
                  checked={h.trainings}
                  onChange={async (trainings) => {
                    await api.patch(`/teams/${team.id}/helpers/${h.person.id}`, { trainings });
                    onChanged();
                  }}
                />
                <SwitchRow
                  label="Stammkader"
                  checked={h.isCore}
                  onChange={async (core) => {
                    const ids = coreIds(team);
                    await api.put(`/teams/${team.id}/core-squad`, { personIds: core ? [...ids, h.person.id] : ids.filter((x) => x !== h.person.id) });
                    onChanged();
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p class="small muted">Dauerhafte Aushilfen aus der jüngeren Jugend oder der 2. Mannschaft sehen eure Spiele und können zu- und absagen.</p>
        )}
      </section>

      <section class="stack-sm" aria-label="Trainer">
        <h2 class="section-title">Trainer · {team.coaches.length}</h2>
        <ul class="list">
          {team.coaches.map((c) => (
            <li class="list-row">
              <span class="main">
                <span class="title">{personName(c.person)}</span>
                <span class="sub">{c.hasAccount ? "hat einen Zugang" : "noch kein Zugang"}</span>
              </span>
            </li>
          ))}
        </ul>
        <p class="small muted">Trainer ordnet ein Admin zu.</p>
      </section>

      {addOpen ? <AddPlayerSheet team={team} onClose={() => setAddOpen(false)} onDone={onChanged} /> : null}
      {coreOpen ? <CoreSheet team={team} onClose={() => setCoreOpen(false)} onDone={onChanged} /> : null}
      {helperOpen ? <HelperSheet team={team} onClose={() => setHelperOpen(false)} onDone={onChanged} /> : null}
    </>
  );
}

function AddPlayerSheet({ team, onClose, onDone }: { team: TeamDetail; onClose: () => void; onDone: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [year, setYear] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  return (
    <Sheet open onClose={onClose} title="Spieler hinzufügen">
      <Segmented
        label="Woher"
        value={mode}
        options={[
          { value: "new", label: "Neu anlegen" },
          { value: "existing", label: "Aus anderer Mannschaft" },
        ]}
        onChange={setMode}
      />
      {mode === "existing" ? <ExistingPlayerPicker team={team} onDone={onDone} /> : null}
      {mode === "new" ? (
        <>
          <TextField label="Vorname" value={first} onInput={setFirst} maxLength={50} />
          <TextField label="Nachname" value={last} onInput={setLast} maxLength={50} />
          <TextField label="Geburtsjahr" value={year} onInput={setYear} inputMode="numeric" maxLength={4} hint="Nur das Jahr. Mehr Daten speichert die App nicht." />
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!first.trim()}
            onClick={async () => {
              const birthYear = year.trim() ? Number(year) : null;
              if (birthYear != null && (!Number.isInteger(birthYear) || birthYear < 1930 || birthYear > 2100)) {
                toast("Bitte ein gültiges Geburtsjahr eingeben.", "error");
                return;
              }
              await api.post(`/teams/${team.id}/players`, { firstName: first.trim(), lastName: last.trim() || null, birthYear });
              toast(`${first.trim()} ist im Kader.`);
              setFirst("");
              setLast("");
              setYear("");
              onDone();
            }}
          >
            Hinzufügen
          </Button>
          <p class="small muted">Danach kann die Person über den Spielerlink einen Zugang einrichten.</p>
        </>
      ) : null}
    </Sheet>
  );
}

/** Spieler einer anderen Mannschaft derselben oder der nächstjüngeren Altersklasse, die dann in beiden spielen. */
function ExistingPlayerPicker({ team, onDone }: { team: TeamDetail; onDone: () => void }) {
  const { data, error, reload } = useQuery<{ candidates: { person: PersonRef; teams: string; isActive: boolean }[] }>(`/teams/${team.id}/player-candidates`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div class="stack-sm">
      <p class="small muted">Die Person bleibt in ihrer bisherigen Mannschaft und spielt zusätzlich in der {team.name}. Deren Trainer werden informiert.</p>
      {!data.candidates.length ? <Empty title="Niemand gefunden">In den passenden Mannschaften gibt es niemanden, der nicht schon hier spielt.</Empty> : null}
      <ul class="list">
        {data.candidates.map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">
                {c.teams}
                {c.isActive ? "" : " · inaktiv"}
              </span>
            </span>
            <Button
              size="sm"
              onClick={async () => {
                await api.post(`/teams/${team.id}/players/existing`, { personId: c.person.id });
                toast(`${c.person.firstName} spielt jetzt auch in der ${team.name}.`);
                void reload();
                onDone();
              }}
            >
              Aufnehmen
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CoreSheet({ team, onClose, onDone }: { team: TeamDetail; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState(coreIds(team));
  return (
    <Sheet open onClose={onClose} title="Stammkader">
      <p class="muted">
        {team.autoSquad
          ? "Der Stammkader ist automatisch für alle Spiele nominiert. Änderungen gelten sofort für alle künftigen Spiele, deren Kader du nicht von Hand angepasst hast."
          : "Der Stammkader ist bei jedem neuen Spiel vorausgewählt."}
      </p>
      <ul class="list">
        {[...team.players.map((p) => ({ person: p.person, note: null as string | null })), ...team.helpers.map((h) => ({ person: h.person, note: `Aushilfe aus der ${h.homeTeam ?? "anderen Mannschaft"}` }))].map((p) => {
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
          toast(`Stammkader gespeichert (${ids.length}).`);
          onClose();
          onDone();
        }}
      >
        Speichern · {ids.length}
      </Button>
    </Sheet>
  );
}

function HelperSheet({ team, onClose, onDone }: { team: TeamDetail; onClose: () => void; onDone: () => void }) {
  const { data, error } = useQuery<{ candidates: { person: PersonRef; team: { id: number; name: string }; isActive: boolean }[] }>(`/teams/${team.id}/helper-candidates`);
  return (
    <Sheet open onClose={onClose} title="Dauerhafte Aushilfe">
      <p class="muted">Aus der 2. Mannschaft derselben Altersklasse oder der nächstjüngeren Jugend.</p>
      {error ? <ErrorBox error={error} /> : null}
      {!data ? <Spinner /> : null}
      {data && !data.candidates.length ? <Notice>Keine passenden Spieler gefunden.</Notice> : null}
      <ul class="list">
        {(data?.candidates ?? []).map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">{c.team.name}</span>
            </span>
            {team.helpers.some((h) => h.person.id === c.person.id) ? (
              <span class="pill pill-muted">Aushilfe</span>
            ) : (
              <Button
                size="sm"
                onClick={async () => {
                  await api.post(`/teams/${team.id}/helpers`, { personId: c.person.id, trainings: false });
                  toast(`${c.person.firstName} ist jetzt Aushilfe.`);
                  onDone();
                }}
              >
                Hinzufügen
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function QrLink({ url }: { url: string }) {
  return <div class="qr" role="img" aria-label="QR-Code des Links" dangerouslySetInnerHTML={{ __html: renderSVG(url, { border: 1 }) }} />;
}

/** Begleittext für WhatsApp & Co.: was der Link ist, einmal pro Person, Hinweis für schon Registrierte. */
export function inviteMessage(kind: "player" | "parent", teamName: string, url: string, expires: string): string {
  const install = "Danach die App aufs Handy holen: iPhone in Safari über „Teilen“ → „Zum Home-Bildschirm“, Android im Browsermenü „App installieren“.";
  if (kind === "player") {
    return [
      `Hallo zusammen! Die ${teamName} nutzt die App ${clubName()} für Termine, Zu- und Absagen und den Mannschaftschat.`,
      "So geht's: Link öffnen, deinen eigenen Namen auswählen und einen Passkey einrichten (Face ID, Fingerabdruck oder Gerätesperre).",
      "Wichtig: Jede und jeder nutzt den Link nur einmal, für sich selbst. Bitte nur den eigenen Namen auswählen.",
      "Dein Name ist ausgegraut? Dann hast du schon einen Zugang. Öffne einfach die App und melde dich an.",
      install,
      `Der Link gilt bis ${expires}:`,
      url,
    ].join("\n\n");
  }
  return [
    `Liebe Eltern der ${teamName}, wir nutzen die App ${clubName()} für Termine, Zu- und Absagen, Helferdienste und den Mannschaftschat.`,
    "So geht's: Link öffnen, euren eigenen Namen eingeben, euer Kind auswählen (Geschwister in derselben Mannschaft gleich mit) und einen Passkey einrichten.",
    "Wichtig: Jedes Elternteil nutzt den Link nur einmal, für sich selbst. Dies ist kein Link für Spieler!",
    "Ihr seid schon in der App, z. B. für ein Geschwisterkind in einer anderen Mannschaft oder als Trainer? Dann öffnet den Link auf dem Handy, auf dem die App installiert ist, und meldet euch zuerst an. Sonst entsteht ein zweiter Zugang.",
    install,
    `Der Link gilt bis ${expires}:`,
    url,
  ].join("\n\n");
}

function InviteCard(props: { team: TeamDetail; kind: "player" | "parent"; invite: InviteView | null; onChanged: () => void }) {
  const { team, kind, invite } = props;
  const title = kind === "player" ? "Spielerlink" : "Elternlink";
  const text =
    kind === "player"
      ? "Spielerinnen und Spieler mit eigenem Smartphone wählen ihren Namen aus und richten einen Passkey ein."
      : "Eltern geben ihren Namen ein, wählen ihr Kind (oder mehrere) und richten einen Passkey ein. Die Verknüpfung gilt sofort.";
  const message = invite ? inviteMessage(kind, team.name, invite.url, fullDate(isoToLocalDate(invite.expiresAt))) : "";
  const create = async () => {
    if (invite && !(await confirmDialog({ title: "Neuen Link erzeugen?", message: "Der bisherige Link funktioniert dann nicht mehr.", confirmLabel: "Neuer Link" }))) return;
    await api.post(`/teams/${team.id}/invites`, { kind });
    toast("Neuer Link erzeugt.");
    props.onChanged();
  };
  return (
    <section class="card card-body" aria-label={title}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <h2 class="section-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {invite ? <span class="small muted">gültig bis {fullDate(isoToLocalDate(invite.expiresAt))}</span> : null}
      </div>
      <p class="muted">{text}</p>
      {invite ? (
        <>
          <QrLink url={invite.url} />
          <div class="url-box">{invite.url}</div>
          <div class="btn-row">
            <Button variant="primary" icon="share" onClick={() => shareLink(`${title} ${team.name}`, message, "")}>
              Mit Text teilen
            </Button>
            <Button icon="copy" onClick={() => copyText(message, "Text mit Link kopiert.")}>
              Text kopieren
            </Button>
          </div>
          <Button size="sm" variant="ghost" icon="copy" onClick={() => copyText(invite.url, "Link kopiert.")}>
            Nur den Link kopieren
          </Button>
          <details class="howto-fold">
            <summary>
              <span>Begleittext ansehen</span>
              <Icon name="chevron" size={18} />
            </summary>
            <p class="small" style={{ whiteSpace: "pre-wrap" }}>
              {message}
            </p>
          </details>
          <div class="btn-row">
            <Button size="sm" variant="ghost" icon="refresh" onClick={create}>
              Neuer Link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={async () => {
                if (!(await confirmDialog({ title: "Link zurückziehen?", message: "Der Link funktioniert danach nicht mehr. Bestehende Zugänge bleiben.", confirmLabel: "Zurückziehen", danger: true }))) return;
                await api.del(`/invites/${invite.id}`);
                props.onChanged();
              }}
            >
              Zurückziehen
            </Button>
          </div>
        </>
      ) : (
        <Button variant="primary" icon="link" onClick={create}>
          Link erzeugen
        </Button>
      )}
    </section>
  );
}

function InvitesTab({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  return (
    <>
      <Notice>
        Teile die Links nur in der privaten WhatsApp-Gruppe der Mannschaft oder zeige den QR-Code direkt. Links laufen nach 14 Tagen ab. In der Kaderübersicht siehst
        du, wer verknüpft ist, und kannst falsche Verknüpfungen lösen.
      </Notice>
      {team.duplicateNames.length ? <Notice kind="warn">Vor dem Teilen bitte die Nachnamen bei gleichen Vornamen ergänzen ({team.duplicateNames.join(", ")}).</Notice> : null}
      <InviteCard team={team} kind="player" invite={team.invites.player} onChanged={onChanged} />
      {team.parentsEnabled ? (
        <InviteCard team={team} kind="parent" invite={team.invites.parent} onChanged={onChanged} />
      ) : (
        <Notice>
          In der {team.name} sind keine Eltern eingebunden. Die Spieler sagen selbst zu und ab und sind allein im Chat. Ein Admin kann das unter Verwaltung,
          Mannschaften ändern.
        </Notice>
      )}
      <p class="small muted">Geräteverlust oder neuer Passkey: In der Kaderübersicht die Person öffnen und einen persönlichen Einmal-Link erzeugen.</p>
    </>
  );
}

function SettingsTab({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const { refresh: refreshSession } = useSession();
  const [training, setTraining] = useState(String(team.declineHoursTraining));
  const [game, setGame] = useState(String(team.declineHoursGame));
  const [maxSquad, setMaxSquad] = useState(String(team.maxSquad));
  const [portal, setPortal] = useState("");
  const h4aSet = team.h4a.orgId != null;
  return (
    <>
      <section class="card card-body" aria-label="Absagefristen">
        <h2 class="section-title" style={{ margin: 0 }}>
          Absagefristen
        </h2>
        <p class="muted small">Bis wie viele Stunden vor Beginn darf ohne Hinweis abgesagt werden? Spätere Absagen sind möglich, gelten aber als kurzfristig.</p>
        <div class="grid-2">
          <TextField label="Training (Std.)" value={training} onInput={setTraining} inputMode="numeric" maxLength={3} />
          <TextField label="Spiel (Std.)" value={game} onInput={setGame} inputMode="numeric" maxLength={3} />
        </div>
        <TextField label="Maximale Kadergröße" value={maxSquad} onInput={setMaxSquad} inputMode="numeric" maxLength={2} />
        <Button
          variant="primary"
          onClick={async () => {
            const values = [training, game, maxSquad].map(Number);
            if (values.some((v) => !Number.isInteger(v) || v < 0) || values[2]! < 1 || values[0]! > 168 || values[1]! > 168) {
              toast("Bitte gültige Zahlen eingeben (Fristen 0 bis 168 Stunden).", "error");
              return;
            }
            await api.patch(`/teams/${team.id}`, { declineHoursTraining: values[0], declineHoursGame: values[1], maxSquad: values[2] });
            invalidate("/events");
            toast("Gespeichert.");
            onChanged();
          }}
        >
          Speichern
        </Button>
      </section>

      <section class="card card-body" aria-label="Kader">
        <h2 class="section-title" style={{ margin: 0 }}>
          Kader für Spiele
        </h2>
        <SwitchRow
          label="Stammkader automatisch für alle Spiele nominieren"
          sub="Spart das Nominieren bei jedem Spiel. Abweichungen bei einzelnen Spielen bleiben möglich. Statt einer Push zur Nominierung kommt drei Tage vor jedem Spiel eine Erinnerung."
          checked={team.autoSquad}
          onChange={async (value) => {
            await api.patch(`/teams/${team.id}`, { autoSquad: value });
            invalidate("/events");
            toast(value ? "Der Stammkader ist jetzt für alle künftigen Spiele nominiert." : "Automatischer Kader ausgeschaltet. Bereits nominierte Kader bleiben.");
            onChanged();
          }}
        />
      </section>

      <section class="card card-body" aria-label="Rückmeldungen">
        <h2 class="section-title" style={{ margin: 0 }}>
          Rückmeldungen
        </h2>
        <SwitchRow
          label="Zu- und Absagen für alle sichtbar"
          sub="Bei Training und Sonderterminen sehen Spieler (und eingebundene Eltern), wer zu- oder abgesagt hat. Gründe sehen weiter nur Trainer. Für Jugendmannschaften besser aus, damit sich niemand von Absagen anderer leiten lässt."
          checked={team.showResponses}
          onChange={async (value) => {
            await api.patch(`/teams/${team.id}`, { showResponses: value });
            invalidate("/events");
            toast(value ? "Zu- und Absagen sind jetzt für alle sichtbar." : "Zu- und Absagen sehen jetzt nur die Trainer.");
            onChanged();
          }}
        />
      </section>

      <section class="card card-body" aria-label="Helferplan">
        <h2 class="section-title" style={{ margin: 0 }}>
          Helferplan
        </h2>
        <SwitchRow
          label="Helferplan für diese Mannschaft"
          sub={
            team.parentsEnabled
              ? "Eltern tragen sich bei Spielen für Dienste wie Kuchen & Theke oder Trikots ein (Reiter „Helfer“)."
              : "Die Spielerinnen und Spieler tragen sich bei Spielen selbst für Dienste ein (Reiter „Helfer“)."
          }
          checked={team.helperPlan}
          onChange={async (value) => {
            await api.patch(`/teams/${team.id}`, { helperPlan: value });
            invalidate("/duties");
            void refreshSession();
            toast(value ? "Helferplan eingeschaltet." : "Helferplan ausgeschaltet. Einträge bleiben erhalten.");
            onChanged();
          }}
        />
        {team.helperPlan ? <TemplateChoice team={team} onChanged={onChanged} /> : null}
      </section>

      <section class="card card-body" aria-label="Spielplan">
        <h2 class="section-title" style={{ margin: 0 }}>
          Spielplan (handball4all)
        </h2>
        {h4aSet ? (
          <p>
            Verknüpft: Verband {team.h4a.orgId}, Liga {team.h4a.leagueId}, Team {team.h4a.teamId}.
            {team.h4a.importedAt ? ` Zuletzt abgeglichen am ${fullDate(isoToLocalDate(team.h4a.importedAt))}.` : " Noch nicht abgeglichen."}
          </p>
        ) : (
          <p class="muted">Noch nicht verknüpft.</p>
        )}
        {team.h4a.error ? <p class="small warn-text">{team.h4a.error}</p> : null}
        <Field
          label="Link aus dem handball4all-Portal"
          hint="Im Portal die Mannschaft öffnen und den Link aus der Adresszeile einfügen. Er enthält ogId, lId und tId."
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
              toast("Verknüpft. Mit „Jetzt abgleichen“ holst du den Spielplan.");
              invalidate(`/teams/${team.id}`);
              onChanged();
            }}
          >
            Verknüpfen
          </Button>
          {h4aSet ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await api.put(`/teams/${team.id}/games/source`, { portalUrl: null });
                onChanged();
              }}
            >
              Lösen
            </Button>
          ) : null}
        </div>
        {h4aSet ? <SourceBar team={{ id: team.id, name: team.name }} /> : null}
        <p class="small muted">Abgeglichen wird nur auf Knopfdruck, auf dem Gerät eines Trainers oder Admins. handball4all erlaubt nur Einzelabrufe, deshalb nie automatisch.</p>
      </section>
    </>
  );
}

// Person (Sicht Trainer) --------------------------------------------------------------

export function PersonPage({ id, personId }: { id: string; personId: string }) {
  const { data: team, error, reload } = useQuery<TeamDetail>(`/teams/${id}`);
  const player = team?.players.find((p) => String(p.person.id) === personId) ?? null;
  const helper = team?.helpers.find((h) => String(h.person.id) === personId) ?? null;
  const person = player?.person ?? helper?.person ?? null;
  useDocumentTitle(person ? personName(person) : "Person");
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
  if (!person) {
    return (
      <main class="page">
        <TopBar title="Person" back={`/team/${id}`} />
        <div class="content">
          <Notice kind="warn">Diese Person gehört nicht (mehr) zur {team.name}.</Notice>
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

  return (
    <main class="page">
      <TopBar
        title={personName(person)}
        kicker={
          <>
            Team <span class="nocaps">{team.name}</span>
          </>
        }
        back={`/team/${id}`}
      />
      <div class="content">
        {(player ?? helper)?.unexcused ? (
          <Notice kind="warn">
            In dieser Saison {(player ?? helper)!.unexcused}× unentschuldigt gefehlt. Ändern lässt sich das im jeweiligen Termin unter{" "}
            <a href="/?zeit=vergangen">Termine → Vergangen</a>.
          </Notice>
        ) : null}
        {player ? (
          <>
            <section class="card card-body" aria-label="Stammdaten">
              <h2 class="section-title" style={{ margin: 0 }}>
                Stammdaten
              </h2>
              <TextField label="Vorname" value={first} onInput={setFirst} maxLength={50} />
              <TextField label="Nachname" value={last} onInput={setLast} maxLength={50} />
              <TextField label="Geburtsjahr" value={year} onInput={setYear} inputMode="numeric" maxLength={4} hint={player.ageWarning ?? "Mehr Daten speichert die App nicht."} />
              <Button
                variant="primary"
                disabled={!first.trim()}
                onClick={async () => {
                  const birthYear = year.trim() ? Number(year) : null;
                  if (birthYear != null && (!Number.isInteger(birthYear) || birthYear < 1930 || birthYear > 2100)) {
                    toast("Bitte ein gültiges Geburtsjahr eingeben.", "error");
                    return;
                  }
                  await api.patch(`/persons/${person.id}`, { firstName: first.trim(), lastName: last.trim() || null, birthYear });
                  toast("Gespeichert.");
                  refresh();
                }}
              >
                Speichern
              </Button>
            </section>
            <ul class="list">
              <li>
                <SwitchRow
                  label="Aktiv"
                  sub={player.isActive ? "Nimmt normal an Terminen teil." : "Inaktiv: alle Termine gelten als abwesend, keine Erinnerungen."}
                  checked={player.isActive}
                  onChange={async (active) => {
                    await api.post(`/persons/${person.id}/active`, { active });
                    toast(active ? `${person.firstName} ist wieder aktiv.` : `${person.firstName} ist inaktiv.`);
                    refresh();
                  }}
                />
              </li>
              <li>
                <SwitchRow
                  label="Stammkader"
                  checked={player.isCore}
                  onChange={async (core) => {
                    const ids = coreIds(team);
                    await api.put(`/teams/${team.id}/core-squad`, { personIds: core ? [...ids, person.id] : ids.filter((x) => x !== person.id) });
                    refresh();
                  }}
                />
              </li>
            </ul>
            <p class="small muted">Inaktiv z. B. bei Verletzung, Krankheit oder Schüleraustausch. Einen Grund speichert die App bewusst nicht.</p>
          </>
        ) : (
          <Notice>
            Aushilfe aus der {helper?.homeTeam ?? "anderen Mannschaft"}. Stammdaten pflegt deren Trainer.
          </Notice>
        )}

        {player ? (
          <section class="card card-body" aria-label="Zugang">
            <h2 class="section-title" style={{ margin: 0 }}>
              Zugang
            </h2>
            <p>{player.hasAccount ? `${person.firstName} hat einen eigenen Zugang.` : `${person.firstName} hat noch keinen eigenen Zugang.`}</p>
            {player.hasAccount ? <p class="small muted">Der Link meldet die bisherigen Geräte ab, zum Beispiel nach einem Geräteverlust.</p> : null}
            <Button icon="link" onClick={() => createLink(person.id, person.firstName)}>
              {player.hasAccount ? "Link für neuen Passkey" : "Persönlichen Einladungslink"}
            </Button>
            {player.hasAccount ? (
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !(await confirmDialog({
                      title: "Zugang lösen?",
                      message: `Der Zugang von ${person.firstName} wird gelöscht, z. B. nach einer falschen Auswahl beim Spielerlink. Die Person bleibt im Kader und kann sich neu registrieren.`,
                      confirmLabel: "Zugang lösen",
                      danger: true,
                    }))
                  )
                    return;
                  await api.del(`/persons/${person.id}/account`);
                  toast("Zugang gelöst.");
                  refresh();
                }}
              >
                Zugang lösen
              </Button>
            ) : null}
          </section>
        ) : null}

        {player ? (
          <section class="card card-body" aria-label="Eltern">
            <h2 class="section-title" style={{ margin: 0 }}>
              Eltern
            </h2>
            {!team!.parentsEnabled ? (
              <p class="muted">In dieser Mannschaft sind keine Eltern eingebunden.</p>
            ) : !player.guardians.length ? (
              <p class="muted">Noch keine Eltern verknüpft. Eltern verknüpfen sich selbst über den Elternlink.</p>
            ) : null}
            {player.guardians.map((g) => (
              <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "10px" }}>
                <div class="row-gap" style={{ justifyContent: "space-between" }}>
                  <strong>{personName(g)}</strong>
                  <span class="small muted">{g.hasAccount ? "mit Zugang" : "ohne Zugang"}</span>
                </div>
                <div class="btn-row">
                  <Button size="sm" icon="link" onClick={() => createLink(g.id, g.firstName)}>
                    Link für neuen Passkey
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      if (
                        !(await confirmDialog({
                          title: "Verknüpfung lösen?",
                          message: `${personName(g)} ist dann nicht mehr mit ${person.firstName} verknüpft. Eltern ohne weiteres Kind werden gelöscht.`,
                          confirmLabel: "Lösen",
                          danger: true,
                        }))
                      )
                        return;
                      await api.del(`/guardianships/${g.id}/${person.id}`);
                      toast("Verknüpfung gelöst.");
                      refresh();
                    }}
                  >
                    Lösen
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section class="stack-sm" aria-label="Weitere Aktionen">
          <Button
            variant="ghost"
            onClick={async () => {
              const role = player ? "player" : "helper";
              if (!(await confirmDialog({ title: `Aus der ${team.name} entfernen?`, message: `${personName(person)} bleibt im Verein, gehört aber nicht mehr zur ${team.name}.`, confirmLabel: "Entfernen" }))) return;
              await api.del(`/teams/${team.id}/members/${person.id}?role=${role}`);
              invalidate(`/teams/${id}`, "/events");
              history.back();
            }}
          >
            Aus der Mannschaft entfernen
          </Button>
          {player ? (
            <Button
              variant="danger"
              icon="door"
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: "Vereinsaustritt eintragen?",
                    message: `${personName(person)} kann sich danach nicht mehr anmelden und erscheint im Chat als „ehemalige/r Spieler/in“. Verknüpfte Eltern ohne weiteres Kind werden ebenfalls deaktiviert. Beim nächsten Saisonwechsel werden alle Daten gelöscht.`,
                    confirmLabel: "Austritt eintragen",
                    danger: true,
                  }))
                )
                  return;
                await api.post(`/persons/${person.id}/leave`, {});
                toast("Austritt eingetragen.");
                invalidate(`/teams/${id}`, "/events");
                history.back();
              }}
            >
              Vereinsaustritt
            </Button>
          ) : null}
        </section>
      </div>
      {link ? (
        <Sheet open onClose={() => setLink(null)} title={`Link für ${link.for}`}>
          <p class="muted">Persönlicher Einmal-Link, gültig bis {fullDate(isoToLocalDate(link.expiresAt))}. Bitte nur direkt an {link.for} weitergeben.</p>
          <QrLink url={link.url} />
          <div class="url-box">{link.url}</div>
          <div class="btn-row">
            <Button variant="primary" icon="share" onClick={() => shareLink(clubName(), `Dein persönlicher Zugang zur App ${clubName()}`, link.url)}>
              Teilen
            </Button>
            <Button icon="copy" onClick={() => copyText(link.url)}>
              Kopieren
            </Button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}


/** Vorlage der Helferdienste für Heim- und Auswärtsspiele (vereinsweit gepflegt, hier nur gewählt). */
function TemplateChoice({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const templates = useQuery<{ templates: TemplateInfo[] }>("/duty-templates");
  const types = useQuery<{ types: DutyTypeInfo[] }>("/duty-types?all=1");
  const list = templates.data?.templates ?? [];
  const typeName = (id: number) => types.data?.types.find((t) => t.id === id)?.name ?? "?";
  const summary = (t: TemplateInfo | undefined) => (t ? t.items.map((i) => (i.slots > 1 ? `${typeName(i.dutyTypeId)} (${i.slots})` : typeName(i.dutyTypeId))).join(", ") || "keine Dienste" : "");
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
                toast("Vorlage gespeichert. Kommende Spiele ohne Einträge bekommen die neuen Dienste.");
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
      {select("homeTemplateId", "Vorlage für Heimspiele", "home")}
      {select("awayTemplateId", "Vorlage für Auswärtsspiele", "away")}
      <p class="small muted">Vorlagen legen fest, welche Dienste es bei jedem Spiel gibt, mit Plätzen und Uhrzeit. Admins pflegen sie unter Verwaltung → Helferdienste. KiHaSL/JuHaSL kommt bei Jugend-Heimspielen F bis C immer automatisch dazu.</p>
    </div>
  );
}
