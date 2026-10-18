import { useEffect, useState } from "preact/hooks";
import type { PersonRef, TeamRef } from "../../shared/types";
import { api } from "../api";
import { fullDate, personName, todayLocal } from "../format";
import { downloadExport } from "../export";
import { Icon } from "../icons";
import { useMe, useSession } from "../session";
import { clearCache, useQuery } from "../store";
import { Button, confirmDialog, ErrorBox, Notice, Sheet, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";

interface Season {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

type Category = "auto" | "choose" | "no_team" | "outgrown" | "missing_birth_year" | "adult" | "ambiguous";

interface PreviewPlayer {
  person: PersonRef;
  birthYear: number | null;
  currentTeams: TeamRef[];
  newAgeClass: { code: string; name: string } | null;
  category: Category;
  options: TeamRef[];
  suggestedTeamIds: number[];
}

interface Preview {
  current: { id: number; name: string } | null;
  next: { id: number; name: string; startsOn: string; endsOn: string };
  ageClassesDefined: boolean;
  players: PreviewPlayer[];
  formerPersons: PersonRef[];
  coaches: { person: PersonRef; team: string }[];
  /** Schulferien BW der neuen Saison, ersetzen beim Wechsel alle Ferienzeiträume */
  holidays: { name: string; startsOn: string; endsOn: string }[];
  holidaysError: string | null;
  holidaySource: string;
}

const CATEGORY: Record<Category, { title: string; text: string }> = {
  outgrown: { title: "Keine Jugend mehr", text: "Aus der A-Jugend herausgewachsen. Den Aktiven zuordnen oder als ehemalig markieren." },
  ambiguous: { title: "Bitte entscheiden", text: "Aus einer gemischten Mannschaft. Bitte die passende Mannschaft wählen." },
  choose: { title: "Mehrere Mannschaften", text: "In der neuen Altersklasse gibt es mehrere Mannschaften. Vorschlag: 1. Mannschaft. Eine 2. Mannschaft wird nach dem Wechsel bei Bedarf neu gebildet." },
  no_team: { title: "Keine passende Mannschaft", text: "Für die neue Altersklasse gibt es keine Mannschaft. Bitte zuordnen oder vorerst ohne Mannschaft lassen." },
  missing_birth_year: { title: "Geburtsjahr fehlt", text: "Ohne Geburtsjahr keine automatische Zuordnung. Vorschlag: bisherige Mannschaft." },
  adult: { title: "Aktive", text: "Bleiben in ihrer Mannschaft, sofern nichts anderes gewählt wird." },
  auto: { title: "Automatisch zugeordnet", text: "Eindeutig nach Jahrgang." },
};

const ORDER: Category[] = ["outgrown", "ambiguous", "choose", "no_team", "missing_birth_year", "adult", "auto"];

type Choice = { teamIds: number[]; former: boolean };

export function SeasonChangePage() {
  useDocumentTitle("Saisonwechsel");
  const me = useMe();
  const { refresh } = useSession();
  const seasons = useQuery<{ seasons: Season[] }>("/seasons");
  const current = seasons.data?.seasons.find((s) => s.isCurrent) ?? null;
  const upcoming = seasons.data?.seasons.find((s) => !s.isCurrent && (!current || s.startsOn > current.startsOn)) ?? null;
  const preview = useQuery<Preview>(upcoming ? `/season-change/preview?seasonId=${upcoming.id}` : null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [exported, setExported] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [finalOpen, setFinalOpen] = useState(false);
  const [done, setDone] = useState<{ assigned: number; deletedPersons: number; deletedParents: number } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!preview.data) return;
    const next: Record<number, Choice> = {};
    for (const p of preview.data.players) next[p.person.id] = { teamIds: p.suggestedTeamIds, former: false };
    setChoices(next);
  }, [preview.data]);

  if (!me.isAdmin) return <Notice kind="warn">Nur für Admins.</Notice>;

  if (done) {
    return (
      <main class="page">
        <TopBar title="Saisonwechsel" kicker="Abgeschlossen" back="/verwaltung" />
        <div class="content">
          <div class="card card-pad stack">
            <h2 style={{ fontSize: "26px" }}>Neue Saison gestartet</h2>
            <p>
              {done.assigned} Spieler zugeordnet, {done.deletedPersons} ehemalige Personen und {done.deletedParents} Elternzugänge ohne Kind gelöscht.
            </p>
          </div>
          <Notice kind="yellow">
            <strong>Nächste Schritte:</strong> Unter Mannschaften die Trainer neu zuordnen, danach legen die Trainer ihre Trainingspläne an und verknüpfen den neuen
            handball4all-Link ihrer Mannschaft.
          </Notice>
          <a class="btn btn-primary" href="/verwaltung/mannschaften">
            Trainer zuordnen
          </a>
        </div>
      </main>
    );
  }

  return (
    <main class="page">
      <TopBar title="Saisonwechsel" kicker="Verwaltung" back="/verwaltung" />
      <div class="content">
        <Notice kind="warn">
          Der Saisonwechsel setzt Mannschaftszugehörigkeiten, Trainingspläne, Termine, Rückmeldungen, Nominierungen, Stammkader und Chatverläufe zurück. Personen,
          Zugänge, Eltern-Verknüpfungen, Mannschaften und Trainingsorte bleiben.
        </Notice>
        {seasons.error ? <ErrorBox error={seasons.error} /> : null}
        {!seasons.data ? <Spinner /> : null}

        <section class="card card-body" aria-label="Schritt 1">
          <h2 class="section-title" style={{ margin: 0 }}>
            1 · Neue Saison
          </h2>
          <p>Laufende Saison: {current ? `${current.name} (${fullDate(current.startsOn)} – ${fullDate(current.endsOn)})` : "keine"}</p>
          {upcoming && editing ? (
            <NewSeasonForm
              current={current}
              season={upcoming}
              onCreated={async () => {
                setEditing(false);
                await seasons.reload();
                await preview.reload();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : upcoming ? (
            <>
              <p>
                Kommende Saison: <strong>{upcoming.name}</strong> ({fullDate(upcoming.startsOn)} – {fullDate(upcoming.endsOn)})
              </p>
              <div class="btn-row">
                <Button icon="edit" onClick={() => setEditing(true)}>
                  Korrigieren
                </Button>
                <Button
                  variant="danger"
                  icon="trash"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: "Saisonwechsel verwerfen?",
                      message: `Die kommende Saison ${upcoming.name} und ihre Altersklassen werden gelöscht. An der laufenden Saison, an Mannschaften, Personen und Terminen ändert sich nichts.`,
                      confirmLabel: "Verwerfen",
                      danger: true,
                    });
                    if (!ok) return;
                    await api.del(`/seasons/${upcoming.id}`);
                    toast("Saisonwechsel verworfen.");
                    await seasons.reload();
                  }}
                >
                  Verwerfen
                </Button>
              </div>
            </>
          ) : seasons.data ? (
            <NewSeasonForm key={current?.id ?? 0} current={current} onCreated={() => seasons.reload()} />
          ) : null}
        </section>

        {upcoming ? (
          <section class="card card-body" aria-label="Schritt 2">
            <h2 class="section-title" style={{ margin: 0 }}>
              2 · Altersklassen {upcoming.name}
            </h2>
            <p class="muted">Aus der Vorsaison übernommen und um ein Jahr verschoben. Bitte mit den Durchführungsbestimmungen des Verbands abgleichen.</p>
            <a class="btn" href={`/verwaltung/altersklassen?season=${upcoming.id}`}>
              Altersklassen prüfen
            </a>
          </section>
        ) : null}

        {upcoming && preview.error ? <ErrorBox error={preview.error} onRetry={preview.reload} /> : null}
        {upcoming && preview.loading ? <Spinner /> : null}
        {preview.data ? (
          <section class="stack" aria-label="Schritt 3">
            <h2 class="section-title">3 · Zuordnung prüfen</h2>
            {!preview.data.ageClassesDefined ? <Notice kind="warn">Für die neue Saison sind keine Altersklassen hinterlegt.</Notice> : null}
            {ORDER.map((cat) => {
              const items = preview.data!.players.filter((p) => p.category === cat);
              if (!items.length) return null;
              return (
                <div class="card card-body">
                  <div>
                    <strong>
                      {CATEGORY[cat].title} · {items.length}
                    </strong>
                    <p class="small muted">{CATEGORY[cat].text}</p>
                  </div>
                  {items.map((p) => {
                    const choice = choices[p.person.id] ?? { teamIds: p.suggestedTeamIds, former: false };
                    const set = (c: Choice) => setChoices({ ...choices, [p.person.id]: c });
                    const allTeams = p.options;
                    return (
                      <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "10px" }}>
                        <div class="row-gap" style={{ justifyContent: "space-between" }}>
                          <span>
                            <strong>{personName(p.person)}</strong>{" "}
                            <span class="small muted">
                              {p.birthYear ? `Jg. ${p.birthYear}` : "ohne Jahrgang"} · bisher {p.currentTeams.map((t) => t.name).join(", ")}
                              {p.newAgeClass ? ` → ${p.newAgeClass.code}` : ""}
                            </span>
                          </span>
                        </div>
                        <select
                          class="select"
                          aria-label={`Neue Mannschaft für ${personName(p.person)}`}
                          value={choice.former ? "former" : (choice.teamIds[0] ?? "")}
                          onChange={(e) => {
                            const v = (e.target as HTMLSelectElement).value;
                            if (v === "former") set({ teamIds: [], former: true });
                            else set({ teamIds: v ? [Number(v), ...choice.teamIds.slice(1).filter((t) => t !== Number(v))] : [], former: false });
                          }}
                        >
                          <option value="">Ohne Mannschaft</option>
                          {allTeams.map((t) => (
                            <option value={t.id}>{t.name}</option>
                          ))}
                          <option value="former">Ehemalig (wird gelöscht)</option>
                        </select>
                        {/* Spieler in zwei Mannschaften (z. B. wC1 und wC2) */}
                        {!choice.former
                          ? choice.teamIds.slice(1).map((teamId, i) => (
                              <div class="row-gap">
                                <select
                                  class="select"
                                  style={{ flex: 1 }}
                                  aria-label={`Weitere Mannschaft für ${personName(p.person)}`}
                                  value={teamId}
                                  onChange={(e) => {
                                    const v = Number((e.target as HTMLSelectElement).value);
                                    const ids = [...choice.teamIds];
                                    ids[i + 1] = v;
                                    set({ teamIds: [...new Set(ids)], former: false });
                                  }}
                                >
                                  {allTeams
                                    .filter((t) => t.id === teamId || !choice.teamIds.includes(t.id))
                                    .map((t) => (
                                      <option value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label="Weitere Mannschaft entfernen"
                                  onClick={() => set({ teamIds: choice.teamIds.filter((_, j) => j !== i + 1), former: false })}
                                >
                                  <Icon name="trash" size={18} />
                                </Button>
                              </div>
                            ))
                          : null}
                        {!choice.former && choice.teamIds.length > 0 && choice.teamIds.length < 3 && allTeams.some((t) => !choice.teamIds.includes(t.id)) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="plus"
                            onClick={() => set({ teamIds: [...choice.teamIds, allTeams.find((t) => !choice.teamIds.includes(t.id))!.id], former: false })}
                          >
                            Weitere Mannschaft
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {preview.data.coaches.length ? (
              <Notice>
                Trainer-Zuordnungen werden aufgehoben und müssen danach neu gesetzt werden:{" "}
                {preview.data.coaches.map((c) => `${personName(c.person)} (${c.team})`).join(", ")}.
              </Notice>
            ) : null}
            {preview.data.formerPersons.length ? (
              <Notice kind="warn">
                Bereits ausgetreten und werden gelöscht: {preview.data.formerPersons.map((p) => personName(p)).join(", ")}.
              </Notice>
            ) : null}
          </section>
        ) : null}

        {preview.data ? (
          <section class="card card-body" aria-label="Ferien der neuen Saison">
            <h2 class="section-title" style={{ margin: 0 }}>
              4 · Ferien der neuen Saison
            </h2>
            <p class="muted">
              Die Schulferien Baden-Württemberg ersetzen beim Wechsel alle bisherigen Ferienzeiträume. Danach lassen sie sich unter Verwaltung → Ferien ändern, löschen
              oder ergänzen (z. B. Fastnachtsferien). Quelle: {preview.data.holidaySource}.
            </p>
            {preview.data.holidaysError ? <Notice kind="warn">{preview.data.holidaysError}</Notice> : null}
            {preview.data.holidays.length ? (
              <ul class="list">
                {preview.data.holidays.map((h) => (
                  <li class="list-row">
                    <Icon name="sun" size={20} />
                    <span class="main">
                      <span class="title">{h.name}</span>
                      <span class="sub">
                        {fullDate(h.startsOn)} – {fullDate(h.endsOn)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {preview.data ? (
          <section class="card card-body" aria-label="Schritt 5">
            <h2 class="section-title" style={{ margin: 0 }}>
              5 · Sicherung
            </h2>
            <p class="muted">Lade vor dem Zurücksetzen einen vollständigen Export herunter. Zusätzlich lässt sich die Datenbank über D1 Time Travel 30 Tage zurücksetzen.</p>
            <Button icon="download" onClick={async () => { if (await downloadExport()) setExported(true); }}>
              Export herunterladen
            </Button>
            {exported ? <p class="small muted">Export gestartet ({todayLocal()}). Bitte prüfen, ob die Datei gespeichert wurde.</p> : null}
          </section>
        ) : null}

        {preview.data ? (
          <Button
            variant="danger-solid"
            size="lg"
            disabled={!exported}
            onClick={async () => {
              const formers = Object.values(choices).filter((c) => c.former).length;
              const ok = await confirmDialog({
                title: `Saison ${preview.data!.next.name} starten?`,
                message: `${preview.data!.players.length - formers} Spieler werden neu zugeordnet, ${formers + preview.data!.formerPersons.length} Personen gelöscht. Termine, Pläne, Rückmeldungen und Chats werden zurückgesetzt, ${preview.data!.holidays.length ? `die Ferien durch ${preview.data!.holidays.length} neue Zeiträume ersetzt` : "die Ferien bleiben unverändert"}.`,
                confirmLabel: "Weiter",
                danger: true,
              });
              if (ok) setFinalOpen(true);
            }}
          >
            Saisonwechsel durchführen
          </Button>
        ) : null}
        {preview.data && !exported ? <p class="small muted">Erst nach dem Export möglich.</p> : null}
      </div>

      {finalOpen && preview.data ? (
        <Sheet open onClose={() => setFinalOpen(false)} title="Letzte Bestätigung">
          <p>
            Zur Bestätigung bitte <strong>{preview.data.next.name}</strong> eingeben.
          </p>
          <TextField label="Neue Saison" value={confirmText} onInput={setConfirmText} />
          <Button
            variant="danger-solid"
            size="lg"
            block
            disabled={confirmText.trim() !== preview.data.next.name}
            onClick={async () => {
              const res = await api.post<{ assigned: number; deletedPersons: number; deletedParents: number }>("/season-change/execute", {
                seasonId: preview.data!.next.id,
                confirmName: confirmText.trim(),
                assignments: preview.data!.players.map((p) => ({ personId: p.person.id, ...(choices[p.person.id] ?? { teamIds: p.suggestedTeamIds, former: false }) })),
                holidays: preview.data!.holidays,
              });
              clearCache();
              await refresh();
              setFinalOpen(false);
              setDone(res);
              toast("Saisonwechsel abgeschlossen.");
            }}
          >
            Endgültig durchführen
          </Button>
        </Sheet>
      ) : null}
    </main>
  );
}

/** Kommende Saison anlegen oder (mit season) korrigieren. */
function NewSeasonForm({ current, season, onCreated, onCancel }: { current: Season | null; season?: Season; onCreated: () => void; onCancel?: () => void }) {
  const startYear = current ? Number(current.startsOn.slice(0, 4)) + 1 : Number(todayLocal().slice(0, 4));
  const [name, setName] = useState(season?.name ?? `${startYear}/${String(startYear + 1).slice(2)}`);
  const [from, setFrom] = useState(season?.startsOn ?? `${startYear}-07-01`);
  const [to, setTo] = useState(season?.endsOn ?? `${startYear + 1}-06-30`);
  return (
    <div class="stack">
      <TextField label="Name" value={name} onInput={setName} hint="Format 2027/28" />
      <div class="grid-2">
        <TextField label="Beginn" type="date" value={from} onInput={setFrom} />
        <TextField label="Ende" type="date" value={to} onInput={setTo} />
      </div>
      <div class="btn-row">
        <Button
          variant="primary"
          onClick={async () => {
            if (season) {
              await api.patch(`/seasons/${season.id}`, { name: name.trim(), startsOn: from, endsOn: to });
              toast("Gespeichert.");
            } else {
              await api.post("/seasons", { name: name.trim(), startsOn: from, endsOn: to });
              toast("Saison angelegt, Altersklassen übernommen.");
            }
            onCreated();
          }}
        >
          {season ? "Speichern" : "Kommende Saison anlegen"}
        </Button>
        {onCancel ? <Button onClick={onCancel}>Abbrechen</Button> : null}
      </div>
    </div>
  );
}
