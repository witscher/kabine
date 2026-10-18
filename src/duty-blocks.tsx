// Time slots of helper duties: time display and the "Add time slot" form.
// Used in the Helpers tab (manage duties) and when creating a special event.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { intlTag } from "../shared/dates";
import { time } from "./format";
import { currentLocale } from "./i18n";
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
  items: {
    dutyTypeId: number;
    slots: number;
    beforeMin: number;
    afterMin: number;
    taskWhen: "before" | "after";
  }[];
}

/** Local time plus minutes (for suggestions in the UI; the server checks). */
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

/** "13:00–16:00", or for tasks "Task · before/after". */
export function blockTime(b: { mode: "onsite" | "task"; startsAt: string; endsAt: string }, eventStart: string): string {
  if (b.mode === "task") return b.startsAt <= eventStart ? t`Task · before` : t`Task · after`;
  return `${time(b.startsAt)}–${time(b.endsAt)}`;
}

export const DURATIONS = [30, 60, 90, 120, 180] as const;

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${new Intl.NumberFormat(intlTag(currentLocale())).format(h)} h`;
}

export interface NewBlock {
  dutyTypeId?: number;
  newTypeName?: string;
  /** Display name (for the list in the form) */
  label: string;
  startsAt: string;
  endsAt: string;
  slots: number;
}

/**
 * "Add time slot" sheet: duty, start, duration (chips), slots, preview.
 * allowNewType: special duty for this event only (special events).
 */
export function BlockSheet(props: {
  date: string;
  start: string;
  /** End of the event for "until end of event" */
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
    <Sheet open onClose={props.onClose} title={t`Add time slot`}>
      <Field label={t`Duty`}>
        {(id) => (
          <select id={id} class="select" value={typeId} onChange={(e) => setTypeId((e.target as HTMLSelectElement).value)}>
            <option value="">{t`– Choose duty –`}</option>
            {choices.map((t) => (
              <option value={String(t.id)}>{t.name}</option>
            ))}
            {props.allowNewType ? <option value="new">{t`New special duty …`}</option> : null}
          </select>
        )}
      </Field>
      {typeId === "new" ? <TextField label={t`Name of the special duty`} value={newName} onInput={setNewName} maxLength={40} hint={t`Only for this event, e.g. barbecue`} /> : null}
      <Field label={t`Start time`}>{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
      <div class="field" role="group" aria-label={t`Duration`}>
        <span class="field-label">
          <Trans>Duration</Trans>
        </span>
        <div class="chips">
          {DURATIONS.map((d) => (
            <button type="button" class={`chip ${duration === d ? "selected" : ""}`} aria-pressed={duration === d ? "true" : "false"} onClick={() => setDuration(d)}>
              {durationLabel(d)}
            </button>
          ))}
          {props.eventEnd ? (
            <button type="button" class={`chip ${duration === "end" ? "selected" : ""}`} aria-pressed={duration === "end" ? "true" : "false"} onClick={() => setDuration("end")}>
              <Trans>until end of event</Trans>
            </button>
          ) : null}
        </div>
      </div>
      <div class="duty-stepper">
        <span>
          <Trans>Slots</Trans>
        </span>
        <button type="button" class="icon-btn icon-btn-sm" aria-label={t`One slot fewer`} onClick={() => setSlots(Math.max(1, slots - 1))}>
          −
        </button>
        <strong aria-live="polite">{slots}</strong>
        <button type="button" class="icon-btn icon-btn-sm" aria-label={t`One slot more`} onClick={() => setSlots(Math.min(20, slots + 1))}>
          +
        </button>
      </div>
      {valid ? (
        <p class="duty-preview">
          {label} · {time(startsAt)}–{time(endsAt)} · {plural(slots, { one: "# slot", other: "# slots" })}
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
        <Trans>Add</Trans>
      </Button>
    </Sheet>
  );
}

/** Change time and slots of an existing block. */
export function BlockEditSheet(props: {
  block: {
    label: string;
    mode: "onsite" | "task";
    startsAt: string;
    endsAt: string;
    total: number;
  };
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
      <p class="small muted">
        <Trans>Only applies to this event.</Trans>
      </p>
      {task ? (
        <Segmented
          label={t`When`}
          value={when}
          onChange={setWhen}
          options={[
            { value: "start", label: t`Before` },
            { value: "end", label: t`After` },
          ]}
        />
      ) : (
        <div class="grid-2">
          <Field label={t`Start time`}>{(id) => <input id={id} class="input" type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}</Field>
          <Field label={t`End time`}>{(id) => <input id={id} class="input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />}</Field>
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
          } else
            await props.onSave({
              startsAt: `${date}T${start}`,
              endsAt: `${date}T${end}`,
            });
          props.onClose();
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </Sheet>
  );
}
