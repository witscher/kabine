// Zeitblöcke der Helferdienste: Anzeige der Zeit und Formular „Zeitblock hinzufügen“.
// Genutzt im Reiter Helfer (Dienste verwalten) und beim Anlegen eines Sondertermins.
import { useState } from "preact/hooks";
import { time } from "./format";
import { useQuery } from "./store";
import { Button, Field, Segmented, Sheet, TextField } from "./ui";

export interface DutyTypeInfo {
  id: number;
  name: string;
  mode: "onsite" | "task";
  whoParents: boolean;
  whoPlayers: boolean;
  whoCoaches: boolean;
  whoMembers: boolean;
  whoReferees: boolean;
  noteAllowed: boolean;
  needsSkill: boolean;
  archived: boolean;
}

export interface TemplateInfo {
  id: number;
  name: string;
  defaultFor: "home" | "away" | null;
  items: { dutyTypeId: number; slots: number; beforeMin: number; afterMin: number; taskWhen: "before" | "after" }[];
}

/** Lokale Zeit plus Minuten (für Vorschläge in der Oberfläche; der Server prüft). */
export function addMinutes(local: string, minutes: number): string {
  const [d, t] = local.split("T") as [string, string];
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const [h, min] = t.split(":").map(Number) as [number, number];
  const dt = new Date(Date.UTC(y, m - 1, day, h, min + minutes));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

export function minutesBetween(from: string, to: string): number {
  const ms = (l: string) => {
    const [d, t] = l.split("T") as [string, string];
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    const [h, min] = t.split(":").map(Number) as [number, number];
    return Date.UTC(y, m - 1, day, h, min);
  };
  return Math.round((ms(to) - ms(from)) / 60_000);
}

/** „13:00–16:00“ bzw. bei Aufgaben „Aufgabe · davor/danach“. */
export function blockTime(b: { mode: "onsite" | "task"; startsAt: string; endsAt: string }, eventStart: string): string {
  if (b.mode === "task") return `Aufgabe · ${b.startsAt <= eventStart ? "davor" : "danach"}`;
  return `${time(b.startsAt)}–${time(b.endsAt)}`;
}

export const DURATIONS = [30, 60, 90, 120, 180] as const;

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${String(h).replace(".", ",")} h`;
}

export interface NewBlock {
  dutyTypeId?: number;
  newTypeName?: string;
  /** Anzeigename (für die Liste im Formular) */
  label: string;
  startsAt: string;
  endsAt: string;
  slots: number;
}

/**
 * Blatt „Zeitblock hinzufügen“: Dienst, Beginn, Dauer (Chips), Plätze, Vorschau.
 * allowNewType: Sonderdienst nur für diesen Termin (Sondertermine).
 */
export function BlockSheet(props: {
  date: string;
  start: string;
  /** Ende des Termins für „bis Terminende“ */
  eventEnd: string | null;
  allowNewType: boolean;
  initial?: Partial<NewBlock>;
  onClose: () => void;
  onSave: (b: NewBlock) => Promise<void> | void;
}) {
  const types = useQuery<{ types: DutyTypeInfo[] }>("/duty-types");
  const choices = (types.data?.types ?? []).filter((t) => !t.whoReferees && !t.archived);
  const [typeId, setTypeId] = useState<string>(props.initial?.dutyTypeId ? String(props.initial.dutyTypeId) : props.initial?.newTypeName ? "new" : "");
  const [newName, setNewName] = useState(props.initial?.newTypeName ?? "");
  const [start, setStart] = useState(props.start);
  const [duration, setDuration] = useState<number | "end">(120);
  const [slots, setSlots] = useState(props.initial?.slots ?? 2);
  const startsAt = `${props.date}T${start}`;
  const endsAt = duration === "end" && props.eventEnd ? props.eventEnd : addMinutes(startsAt, duration === "end" ? 120 : duration);
  const selected = choices.find((t) => String(t.id) === typeId);
  const label = typeId === "new" ? newName.trim() : (selected?.name ?? "");
  const valid = !!label && !!start && endsAt > startsAt;
  return (
    <Sheet open onClose={props.onClose} title="Zeitblock hinzufügen">
      <Field label="Dienst">
        {(id) => (
          <select id={id} class="select" value={typeId} onChange={(e) => setTypeId((e.target as HTMLSelectElement).value)}>
            <option value="">– Dienst wählen –</option>
            {choices.map((t) => (
              <option value={String(t.id)}>{t.name}</option>
            ))}
            {props.allowNewType ? <option value="new">Neuer Sonderdienst …</option> : null}
          </select>
        )}
      </Field>
      {typeId === "new" ? (
        <TextField label="Name des Sonderdienstes" value={newName} onInput={setNewName} maxLength={40} hint="Gilt nur für diesen Termin, z. B. Grill" />
      ) : null}
      <Field label="Beginn">{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
      <div class="field" role="group" aria-label="Dauer">
        <span class="field-label">Dauer</span>
        <div class="chips">
          {DURATIONS.map((d) => (
            <button type="button" class={`chip ${duration === d ? "selected" : ""}`} aria-pressed={duration === d ? "true" : "false"} onClick={() => setDuration(d)}>
              {durationLabel(d)}
            </button>
          ))}
          {props.eventEnd ? (
            <button type="button" class={`chip ${duration === "end" ? "selected" : ""}`} aria-pressed={duration === "end" ? "true" : "false"} onClick={() => setDuration("end")}>
              bis Terminende
            </button>
          ) : null}
        </div>
      </div>
      <div class="duty-stepper">
        <span>Plätze</span>
        <button type="button" class="icon-btn icon-btn-sm" aria-label="Ein Platz weniger" onClick={() => setSlots(Math.max(1, slots - 1))}>
          −
        </button>
        <strong aria-live="polite">{slots}</strong>
        <button type="button" class="icon-btn icon-btn-sm" aria-label="Ein Platz mehr" onClick={() => setSlots(Math.min(20, slots + 1))}>
          +
        </button>
      </div>
      {valid ? (
        <p class="duty-preview">
          {label} · {time(startsAt)}–{time(endsAt)} · {slots === 1 ? "1 Platz" : `${slots} Plätze`}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!valid}
        onClick={async () => {
          await props.onSave({
            ...(typeId === "new" ? { newTypeName: newName.trim() } : { dutyTypeId: Number(typeId) }),
            label,
            startsAt,
            endsAt,
            slots,
          });
          props.onClose();
        }}
      >
        Hinzufügen
      </Button>
    </Sheet>
  );
}

/** Uhrzeit und Plätze eines bestehenden Blocks ändern. */
export function BlockEditSheet(props: {
  block: { label: string; mode: "onsite" | "task"; startsAt: string; endsAt: string; total: number };
  onClose: () => void;
  onSave: (v: { startsAt: string; endsAt: string }) => Promise<void> | void;
}) {
  const date = props.block.startsAt.slice(0, 10);
  const [start, setStart] = useState(props.block.startsAt.slice(11, 16));
  const [end, setEnd] = useState(props.block.endsAt.slice(11, 16));
  const [when, setWhen] = useState<"start" | "end">("end");
  const task = props.block.mode === "task";
  return (
    <Sheet open onClose={props.onClose} title={props.block.label}>
      <p class="small muted">Gilt nur für diesen Termin.</p>
      {task ? (
        <Segmented
          label="Wann"
          value={when}
          onChange={setWhen}
          options={[
            { value: "start", label: "Davor" },
            { value: "end", label: "Danach" },
          ]}
        />
      ) : (
        <div class="grid-2">
          <Field label="Beginn">{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
          <Field label="Ende">{(id) => <input id={id} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
        </div>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!task && (!start || !end || end < start)}
        onClick={async () => {
          if (task) {
            const at = when === "start" ? `${date}T${start}` : `${date}T${end}`;
            await props.onSave({ startsAt: at, endsAt: at });
          } else await props.onSave({ startsAt: `${date}T${start}`, endsAt: `${date}T${end}` });
          props.onClose();
        }}
      >
        Speichern
      </Button>
    </Sheet>
  );
}
