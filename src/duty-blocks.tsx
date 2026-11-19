// Time slots of helper duties: time display, the "Add time slot" form and "Helpers from".
// Used in the Helpers tab (manage duties), on the event page and when creating a special event.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { intlTag } from "../shared/dates";
import { time } from "./format";
import { currentLocale } from "./i18n";
import { useQuery } from "./store";
import type { HelpText } from "./help-texts";
import { Button, Field, InfoButton, Segmented, Sheet, TextField } from "./ui";

export interface DutyTypeInfo {
  id: number;
  name: string;
  mode: "onsite" | "task";
  whoParents: boolean;
  whoPlayers: boolean;
  whoCoaches: boolean;
  whoMembers: boolean;
  whoQualified: boolean;
  noteAllowed: boolean;
  needsSkill: boolean;
  /** Who approves the prior knowledge: the person in the profile or an admin */
  skillGrant: "self" | "admin";
  /** Assigned by the coach: nobody signs up themselves */
  assignOnly?: boolean;
  /** Send "helpers wanted" */
  notifyOpen?: boolean;
  /** Adults only (by birth year) */
  adultsOnly?: boolean;
  archived: boolean;
  /** Admins only: where the type is used (it can only be deleted when nowhere) */
  usage?: { blocks: number; templates: number; ageClasses: number; grants: number };
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
    helperMode?: HelperMode;
    helperTeams?: number[];
  }[];
}

/** "Helpers from": as the duty type ("who helps"), certain teams, or taking turns (templates only). */
export type HelperMode = "default" | "teams" | "rotate";

/** "Helpers from" on a block, as the server sends it */
export interface HelperFrom {
  mode: "teams" | "rotate";
  teams: { id: number; name: string }[];
  /** Taking turns: the team in charge this time */
  current: { id: number; name: string } | null;
  /** Managers: the team in charge has an event of its own at the same time */
  conflict: string | null;
}

export function helperFromText(h: HelperFrom | null | undefined): string | null {
  if (!h) return null;
  if (h.mode === "rotate") {
    const team = h.current?.name;
    return team ? t`this time ${team}` : t`taking turns, no team yet`;
  }
  const teams = h.teams.map((tm) => tm.name).join(", ");
  return t`from ${teams}`;
}

export const helperFromHelp = (): HelpText => ({
  title: t`Helpers from …`,
  text: t`“As duty type”: as set under “Who helps” on the duty type, for example the parents of the event's team. “Teams”: only players of the chosen teams; for children the parents sign the child up and the child does the duty. They find the duty in the Helpers tab under “Help out”. “Taking turns” (templates only): each game the next team of the list is in charge and is told in its chat a week before. Coaches and admins can change the team in charge per game and see when it has an event of its own at the same time.`,
  example: t`Home game of the first team: wipers taking turns from the under-11 and under-13 teams, stewards from the second team.`,
});

export function useTeamOptions() {
  return useQuery<{ teams: { id: number; name: string }[] }>("/duties/team-options").data?.teams ?? [];
}

/** Choice of "Helpers from". When taking turns, the order is the order of choosing (first chosen, first in charge). */
export function HelperSourceField(props: { mode: HelperMode; teams: number[]; allowRotate: boolean; onChange: (mode: HelperMode, teams: number[]) => void }) {
  const options = useTeamOptions();
  const name = (id: number) => options.find((tm) => tm.id === id)?.name ?? "?";
  const toggle = (id: number) => props.onChange(props.mode, props.teams.includes(id) ? props.teams.filter((x) => x !== id) : [...props.teams, id]);
  const order = props.teams.map(name).join(" → ");
  return (
    <div class="field stack-sm" role="group" aria-label={t`Helpers from`}>
      <span class="field-label">
        <Trans>Helpers from …</Trans> <InfoButton topic={helperFromHelp()} />
      </span>
      <Segmented<HelperMode>
        label={t`Where the helpers come from`}
        value={props.mode}
        onChange={(m) => props.onChange(m, m === "default" ? [] : props.teams)}
        options={[
          { value: "default", label: t`As duty type` },
          { value: "teams", label: t`Teams` },
          ...(props.allowRotate ? [{ value: "rotate" as const, label: t`Taking turns` }] : []),
        ]}
      />
      {props.mode !== "default" ? (
        <>
          <div class="chips" role="group" aria-label={t`Teams for helpers from`}>
            {options.map((tm) => {
              const i = props.teams.indexOf(tm.id);
              return (
                <button type="button" class={`chip ${i >= 0 ? "selected" : ""}`} aria-pressed={i >= 0 ? "true" : "false"} onClick={() => toggle(tm.id)}>
                  {props.mode === "rotate" && i >= 0 ? `${i + 1}. ` : ""}
                  {tm.name}
                </button>
              );
            })}
          </div>
          <span class="small muted">
            {props.mode === "rotate"
              ? props.teams.length
                ? t`Order: ${order}. Each game the next team is in charge.`
                : t`Choose the teams in the order in which they take their turns.`
              : t`Only players of these teams sign up, children through their parents.`}
          </span>
        </>
      ) : null}
    </div>
  );
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

export const DURATIONS = [30, 60, 90, 120, 150, 180] as const;

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
  /** "Helpers from": as the duty type or certain teams */
  helperMode?: "default" | "teams";
  helperTeams?: number[];
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
  const choices = (types.data?.types ?? []).filter((t) => !t.whoQualified && !t.archived);
  const [typeId, setTypeId] = useState<string>(props.initial?.dutyTypeId ? String(props.initial.dutyTypeId) : props.initial?.newTypeName ? "new" : "");
  const [newName, setNewName] = useState(props.initial?.newTypeName ?? "");
  const [start, setStart] = useState(props.start);
  const [duration, setDuration] = useState<number | "end">(120);
  const [slots, setSlots] = useState(props.initial?.slots ?? 2);
  const [helper, setHelper] = useState<{ mode: HelperMode; teams: number[] }>({ mode: props.initial?.helperMode ?? "default", teams: props.initial?.helperTeams ?? [] });
  const startsAt = `${props.date}T${start}`;
  const endsAt = duration === "end" && props.eventEnd ? props.eventEnd : addMinutes(startsAt, duration === "end" ? 120 : duration);
  const selected = choices.find((t) => String(t.id) === typeId);
  const label = typeId === "new" ? newName.trim() : (selected?.name ?? "");
  const valid = !!label && !!start && endsAt > startsAt && (helper.mode === "default" || helper.teams.length > 0);
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
      <HelperSourceField mode={helper.mode} teams={helper.teams} allowRotate={false} onChange={(mode, teams) => setHelper({ mode, teams })} />
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
            ...(helper.mode === "teams" ? { helperMode: "teams" as const, helperTeams: helper.teams } : {}),
          });
          props.onClose();
        }}
      >
        <Trans>Add</Trans>
      </Button>
    </Sheet>
  );
}

export interface BlockEdit {
  startsAt: string;
  endsAt: string;
  rotateTeamId?: number;
  helperMode?: "default" | "teams";
  helperTeams?: number[];
}

/** Change the time, "helpers from" or, when teams take turns, the team in charge of an existing block. */
export function BlockEditSheet(props: {
  block: {
    label: string;
    mode: "onsite" | "task";
    startsAt: string;
    endsAt: string;
    total: number;
    helperFrom?: HelperFrom | null;
  };
  onClose: () => void;
  onSave: (v: BlockEdit) => Promise<void> | void;
}) {
  const hf = props.block.helperFrom ?? null;
  const [rotateTeam, setRotateTeam] = useState(hf?.current?.id ?? hf?.teams[0]?.id ?? 0);
  const [helper, setHelper] = useState<{ mode: HelperMode; teams: number[] }>({
    mode: hf?.mode === "teams" ? "teams" : "default",
    teams: hf?.mode === "teams" ? hf.teams.map((tm) => tm.id) : [],
  });
  const extra = (): Partial<BlockEdit> =>
    hf?.mode === "rotate"
      ? rotateTeam && rotateTeam !== hf.current?.id
        ? { rotateTeamId: rotateTeam }
        : {}
      : { helperMode: helper.mode === "teams" ? "teams" : "default", helperTeams: helper.mode === "teams" ? helper.teams : [] };
  const order = hf ? hf.teams.map((tm) => tm.name).join(" → ") : "";
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
      {hf?.mode === "rotate" ? (
        <div class="field stack-sm">
          <Field label={t`In charge this time`}>
            {(id) => (
              <select id={id} class="select" value={String(rotateTeam)} onChange={(e) => setRotateTeam(Number((e.target as HTMLSelectElement).value))}>
                {hf.teams.map((tm) => (
                  <option value={String(tm.id)}>{tm.name}</option>
                ))}
              </select>
            )}
          </Field>
          {hf.conflict ? <p class="small duty-conflict">{hf.conflict}</p> : null}
          <span class="small muted">
            <Trans>Taking turns: {order}. The new team is told in its chat in good time.</Trans>
          </span>
        </div>
      ) : (
        <HelperSourceField mode={helper.mode} teams={helper.teams} allowRotate={false} onChange={(mode, teams) => setHelper({ mode, teams })} />
      )}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={(!task && (!start || !end || end < start)) || (helper.mode === "teams" && !helper.teams.length)}
        onClick={async () => {
          if (task) {
            const at = when === "start" ? `${date}T${start}` : `${date}T${end}`;
            await props.onSave({ startsAt: at, endsAt: at, ...extra() });
          } else
            await props.onSave({
              startsAt: `${date}T${start}`,
              endsAt: `${date}T${end}`,
              ...extra(),
            });
          props.onClose();
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </Sheet>
  );
}
