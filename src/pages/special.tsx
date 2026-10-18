import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import type { EventDetail } from "../../shared/types";
import { api } from "../api";
import { addMinutes, BlockSheet, durationLabel, minutesBetween, type DutyTypeInfo, type NewBlock, type TemplateInfo } from "../duty-blocks";
import { addDays, time as timeOf, todayLocal } from "../format";
import { Icon } from "../icons";
import { useMe } from "../session";
import { invalidate, useQuery } from "../store";
import {
  Button,
  Field,
  Segmented,
  SwitchRow,
  TextField,
  toast,
  TopBar,
  useDocumentTitle,
} from "../ui";
import { useLocations } from "./event";

type NewKind = "game" | "special";

/**
 * Termin anlegen. Aus einer Mannschaft heraus: Spiel ohne handball4all (Freundschaftsspiel,
 * Turnier) oder Sondertermin. Unter Verwaltung nur Sondertermine (auch für mehrere Mannschaften).
 */
export function SpecialEventPage({ id }: { id?: string }) {
  useDocumentTitle("Termin anlegen");
  const [kind, setKind] = useState<NewKind>("special");
  const me = useMe();
  const { route } = useLocation();
  const { data: locs } = useLocations();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(addDays(todayLocal(), 7));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const teams = me.manageableTeams;
  // Aus einer Mannschaft heraus ist sie vorausgewählt, ebenso wenn es nur eine gibt
  const [teamIds, setTeamIds] = useState<number[]>(
    id ? [Number(id)] : teams.length === 1 ? [teams[0]!.id] : [],
  );
  const [clubWide, setClubWide] = useState(false);
  const [blocks, setBlocks] = useState<NewBlock[]>([]);
  // Gruppen haben nur Sondertermine
  const isGroup = !!id && me.groupIds.includes(Number(id));

  return (
    <main class="page">
      <TopBar
        title={kind === "game" ? "Spiel anlegen" : "Sondertermin"}
        kicker={clubWide ? "Ganzer Verein" : "Termin anlegen"}
        back={id ? `/team/${id}` : "/verwaltung/sondertermine"}
      />
      <div class="content">
        {isGroup ? <p class="small muted">Z. B. Treffen oder Fortbildung. Alle Mitglieder der Gruppe sind eingeladen und sagen zu oder ab.</p> : null}
        {id && !isGroup ? (
          <>
            <Segmented<NewKind>
              label="Art des Termins"
              value={kind}
              onChange={setKind}
              options={[
                { value: "game", label: "Spiel" },
                { value: "special", label: "Sondertermin" },
              ]}
            />
            <p class="small muted">
              {kind === "game"
                ? "Ein Spiel, das nicht bei handball4all steht, z. B. Freundschaftsspiel oder Turnier. Mit Kader, Treffpunkt und Helferdiensten wie bei jedem Spiel."
                : "Z. B. Fotoshooting, Feier oder Elternabend. Alle der Mannschaft sind eingeladen und sagen zu oder ab."}
            </p>
          </>
        ) : null}
        {kind === "game" && id ? (
          <NewGameForm teamId={Number(id)} locations={locs?.locations ?? []} />
        ) : null}
        {kind === "special" ? (
          <>
            <TextField
              label="Titel"
              value={title}
              onInput={setTitle}
              maxLength={80}
              placeholder="z. B. Saisonabschluss, Turnier, Fotoshooting"
            />
            <Field label="Datum">
              {(fid) => (
                <input
                  id={fid}
                  class="input"
                  type="date"
                  value={date}
                  onInput={(e) => setDate((e.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <div class="grid-2">
              <Field label="Beginn">
                {(fid) => (
                  <input
                    id={fid}
                    class="input"
                    type="time"
                    value={start}
                    onInput={(e) =>
                      setStart((e.target as HTMLInputElement).value)
                    }
                  />
                )}
              </Field>
              <Field label="Ende (optional)">
                {(fid) => (
                  <input
                    id={fid}
                    class="input"
                    type="time"
                    value={end}
                    onInput={(e) =>
                      setEnd((e.target as HTMLInputElement).value)
                    }
                  />
                )}
              </Field>
            </div>
            <Field label="Ort (optional)">
              {(fid) => (
                <select
                  id={fid}
                  class="select"
                  value={locationId ?? ""}
                  onChange={(e) =>
                    setLocationId(
                      Number((e.target as HTMLSelectElement).value) || null,
                    )
                  }
                >
                  <option value="">Kein Ort</option>
                  {(locs?.locations ?? []).map((l) => (
                    <option value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Infos (optional)">
              {(fid) => (
                <textarea
                  id={fid}
                  class="textarea"
                  value={notes}
                  maxLength={1000}
                  onInput={(e) =>
                    setNotes((e.target as HTMLTextAreaElement).value)
                  }
                />
              )}
            </Field>
            {me.isAdmin ? (
              <ul class="list">
                <li>
                  <SwitchRow
                    label="Für den ganzen Verein"
                    sub="Alle Spielerinnen und Spieler aller Mannschaften"
                    checked={clubWide}
                    onChange={setClubWide}
                  />
                </li>
              </ul>
            ) : null}
            {!clubWide && teams.length ? (
              <div class="field" role="group" aria-label="Mannschaften">
                <span class="field-label">Mannschaften</span>
                {teams.length > 1 ? (
                  <span class="field-hint">Mehrere möglich</span>
                ) : null}
                <div class="chips">
                  {teams.map((t) => (
                    <button
                      type="button"
                      class={`chip ${teamIds.includes(t.id) ? "selected" : ""}`}
                      aria-pressed={teamIds.includes(t.id) ? "true" : "false"}
                      onClick={() =>
                        setTeamIds(
                          teamIds.includes(t.id)
                            ? teamIds.filter((x) => x !== t.id)
                            : [...teamIds, t.id],
                        )
                      }
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {!clubWide ? (
              <HelperBlocks date={date} start={start} end={end} blocks={blocks} onChange={setBlocks} />
            ) : null}
            <Button
              variant="primary"
              size="lg"
              disabled={!title.trim() || (!clubWide && !teamIds.length)}
              onClick={async () => {
                if (end && end <= start) {
                  toast("Das Ende muss nach dem Beginn liegen.", "error");
                  return;
                }
                const event = await api.post<EventDetail>("/events", {
                  title: title.trim(),
                  startsAt: `${date}T${start}`,
                  endsAt: end ? `${date}T${end}` : null,
                  locationId,
                  notes: notes.trim() || null,
                  teamIds: clubWide ? [] : teamIds,
                  clubWide,
                  // Zeitblöcke hängen am Datum des Termins (Datum kann nach dem Anlegen der Blöcke geändert worden sein)
                  duties: clubWide
                    ? []
                    : blocks.map((b) => ({
                        ...(b.newTypeName ? { newTypeName: b.newTypeName } : { dutyTypeId: b.dutyTypeId }),
                        startsAt: `${date}${b.startsAt.slice(10)}`,
                        endsAt: `${date}${b.endsAt.slice(10)}`,
                        slots: b.slots,
                      })),
                });
                if (blocks.length) invalidate("/duties");
                invalidate("/events");
                toast(
                  "Termin angelegt. Alle Beteiligten wurden benachrichtigt.",
                );
                route(`/termine/${event.id}`, true);
              }}
            >
              Termin anlegen
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}

function NewGameForm({
  teamId,
  locations,
}: {
  teamId: number;
  locations: { id: number; name: string }[];
}) {
  const { route } = useLocation();
  const [opponent, setOpponent] = useState("");
  const [where, setWhere] = useState<"home" | "away">("home");
  const [date, setDate] = useState(addDays(todayLocal(), 7));
  const [time, setTime] = useState("11:00");
  const [locationId, setLocationId] = useState<number | null>(null);
  return (
    <>
      <TextField
        label="Gegner oder Turnier"
        value={opponent}
        onInput={setOpponent}
        maxLength={80}
        placeholder="z. B. HSG Musterstadt"
      />
      <Segmented<"home" | "away">
        label="Heim oder auswärts"
        value={where}
        onChange={setWhere}
        options={[
          { value: "home", label: "Heimspiel" },
          { value: "away", label: "Auswärts" },
        ]}
      />
      <div class="grid-2">
        <Field label="Datum">
          {(fid) => (
            <input
              id={fid}
              class="input"
              type="date"
              value={date}
              onInput={(e) => setDate((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
        <Field label="Anwurf">
          {(fid) => (
            <input
              id={fid}
              class="input"
              type="time"
              value={time}
              onInput={(e) => setTime((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
      </div>
      <Field label="Halle (optional)">
        {(fid) => (
          <select
            id={fid}
            class="select"
            value={locationId ?? ""}
            onChange={(e) =>
              setLocationId(
                Number((e.target as HTMLSelectElement).value) || null,
              )
            }
          >
            <option value="">Keine Angabe</option>
            {locations.map((l) => (
              <option value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Button
        variant="primary"
        size="lg"
        disabled={!opponent.trim() || !date || !time}
        onClick={async () => {
          const res = await api.post<{ id: number }>(
            `/duties/teams/${teamId}/games`,
            {
              opponent: opponent.trim(),
              isHome: where === "home",
              date,
              time,
              locationId,
            },
          );
          invalidate("/events");
          invalidate("/duties");
          toast("Spiel angelegt. Die Mannschaft wurde benachrichtigt.");
          route(`/termine/${res.id}`, true);
        }}
      >
        Spiel anlegen
      </Button>
    </>
  );
}

/**
 * „Helfer benötigt“ beim Anlegen eines Sondertermins: Zeitblöcke von Hand, „+ Anschluss“
 * (gleicher Dienst, gleiche Dauer, direkt danach) und „Aus Vorlage übernehmen“.
 */
function HelperBlocks({ date, start, end, blocks, onChange }: { date: string; start: string; end: string; blocks: NewBlock[]; onChange: (b: NewBlock[]) => void }) {
  const [on, setOn] = useState(blocks.length > 0);
  const [adding, setAdding] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const types = useQuery<{ types: DutyTypeInfo[] }>(on ? "/duty-types" : null);
  const templates = useQuery<{ templates: TemplateInfo[] }>(on ? "/duty-templates" : null);
  const eventStart = `${date}T${start}`;
  const eventEnd = end && end > start ? `${date}T${end}` : null;
  const sorted = [...blocks].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const last = blocks[blocks.length - 1];

  const applyTemplate = () => {
    const t = templates.data?.templates.find((x) => String(x.id) === templateId);
    if (!t) return;
    const coreEnd = eventEnd ?? addMinutes(eventStart, 120);
    const added: NewBlock[] = [];
    for (const item of t.items) {
      const type = types.data?.types.find((x) => x.id === item.dutyTypeId);
      if (!type) continue;
      if (type.mode === "task") {
        const at = item.taskWhen === "before" ? eventStart : coreEnd;
        added.push({ dutyTypeId: type.id, label: type.name, startsAt: at, endsAt: at, slots: item.slots });
      } else {
        added.push({ dutyTypeId: type.id, label: type.name, startsAt: addMinutes(eventStart, -item.beforeMin), endsAt: addMinutes(coreEnd, item.afterMin), slots: item.slots });
      }
    }
    onChange([...blocks, ...added]);
    setTemplateId("");
    toast(added.length === 1 ? "1 Zeitblock übernommen." : `${added.length} Zeitblöcke übernommen.`);
  };

  return (
    <section class="stack-sm" aria-label="Helfer benötigt">
      <ul class="list">
        <li>
          <SwitchRow
            label="Helfer benötigt"
            sub="Zeitblöcke erscheinen im Reiter Helfer, dort tragen sich Eltern bzw. Spieler ein."
            checked={on}
            onChange={(v) => {
              setOn(v);
              if (!v) onChange([]);
            }}
          />
        </li>
      </ul>
      {on ? (
        <>
          {sorted.length ? (
            <ul class="list" aria-label="Zeitblöcke">
              {sorted.map((b) => {
                const task = b.startsAt === b.endsAt;
                return (
                  <li class="list-row">
                    <span class="main">
                      <span class="title">
                        {task ? "Aufgabe" : `${timeOf(b.startsAt)}–${timeOf(b.endsAt)}`} · {b.label}
                      </span>
                      <span class="sub">
                        {task ? "" : `${durationLabel(minutesBetween(b.startsAt, b.endsAt))} · `}
                        {b.slots === 1 ? "1 Platz" : `${b.slots} Plätze`}
                        {b.newTypeName ? " · Sonderdienst" : ""}
                      </span>
                    </span>
                    <button type="button" class="icon-btn icon-btn-sm" aria-label={`${b.label} ${timeOf(b.startsAt)} entfernen`} onClick={() => onChange(blocks.filter((x) => x !== b))}>
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="small muted">Noch keine Zeitblöcke.</p>
          )}
          <div class="btn-row">
            <Button size="sm" variant="dashed" icon="plus" onClick={() => setAdding(true)}>
              Zeitblock
            </Button>
            {last && last.startsAt !== last.endsAt ? (
              <Button
                size="sm"
                variant="dashed"
                icon="plus"
                onClick={() => {
                  const minutes = minutesBetween(last.startsAt, last.endsAt);
                  onChange([...blocks, { ...last, startsAt: last.endsAt, endsAt: addMinutes(last.endsAt, minutes) }]);
                }}
              >
                Anschluss
              </Button>
            ) : null}
          </div>
          {templates.data?.templates.length ? (
            <div class="duty-template-apply">
              <Field label="Aus Vorlage übernehmen">
                {(fid) => (
                  <select id={fid} class="select" value={templateId} onChange={(e) => setTemplateId((e.target as HTMLSelectElement).value)}>
                    <option value="">– Vorlage wählen –</option>
                    {templates.data!.templates.map((t) => (
                      <option value={String(t.id)}>{t.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Button size="sm" disabled={!templateId || !types.data} onClick={applyTemplate}>
                Übernehmen
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {adding ? (
        <BlockSheet
          date={date}
          start={last && last.startsAt !== last.endsAt ? last.endsAt.slice(11, 16) : start}
          eventEnd={eventEnd}
          allowNewType
          onClose={() => setAdding(false)}
          onSave={(b) => onChange([...blocks, b])}
        />
      ) : null}
    </section>
  );
}
