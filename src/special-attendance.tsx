// How people respond to a special event (docs/dev/decisions.md, Special events: attendance modes): without attendance,
// optional attendance or registration per family. Switches for the create and edit forms, the notice on the event page,
// the family registration and the overviews for coaches, admins and organisers.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { EventDetail, EventSummary, FamilyOverview, MyFamily } from "../shared/types";
import { api } from "./api";
import { refreshBadge } from "./badge";
import { invalidate } from "./store";
import { Button, Notice, SwitchRow, toast } from "./ui";

export interface AttendanceModes {
  noAttendance: boolean;
  optionalAttendance: boolean;
  familyAttendance: boolean;
}

export const NO_MODE: AttendanceModes = { noAttendance: false, optionalAttendance: false, familyAttendance: false };

/** The three switches; turning one on turns the others off (the server refuses two). */
export function AttendanceModeSwitches({ value, onChange }: { value: AttendanceModes; onChange: (v: AttendanceModes) => void }) {
  const set = (key: keyof AttendanceModes) => (on: boolean) => onChange(on ? { ...NO_MODE, [key]: true } : { ...value, [key]: false });
  return (
    <>
      <li>
        <SwitchRow info="noAttendance" label={t`Without attendance`} checked={value.noAttendance} onChange={set("noAttendance")} />
      </li>
      <li>
        <SwitchRow info="optionalAttendance" label={t`Optional attendance`} checked={value.optionalAttendance} onChange={set("optionalAttendance")} />
      </li>
      <li>
        <SwitchRow info="familyAttendance" label={t`Registration per family`} checked={value.familyAttendance} onChange={set("familyAttendance")} />
      </li>
    </>
  );
}

/** At the top of the event page: how to respond to this event. */
export function AttendanceModeNotice({ event }: { event: EventSummary }) {
  if (event.cancelled) return null;
  if (event.noAttendance) {
    return (
      <Notice icon="info">
        <Trans>No need to accept or decline: whoever wants to, just comes along. Whoever signed up for a helper duty comes at their time, of course.</Trans>
      </Notice>
    );
  }
  if (event.optionalAttendance) {
    return (
      <Notice icon="info">
        <Trans>Optional attendance: whoever wants to join, please say yes.</Trans>
      </Notice>
    );
  }
  if (event.familyAttendance) {
    return (
      <Notice icon="info">
        <Trans>Registration per family: please say how many of your family are coming.</Trans>
      </Notice>
    );
  }
  return null;
}

const personsText = (n: number) => plural(n, { one: "# person", other: "# people" });

function familyState(family: MyFamily): string {
  const persons = personsText(family.count ?? 0);
  if (family.count) return t`Registered · ${persons}`;
  if (family.count === 0) return family.members === 1 ? t`You are not coming` : t`Your family is not coming`;
  return t`Not registered yet`;
}

/** Registration per family in lists (home): the state and the way to the event. */
export function FamilyShort({ event }: { event: EventSummary }) {
  const f = event.myFamily;
  if (!f) return null;
  const open = !event.isPast && !event.cancelled;
  return (
    <div class="row-gap" style={{ justifyContent: "space-between" }}>
      <span class={`pill ${f.count ? "pill-yes" : "pill-muted"}`}>{familyState(f)}</span>
      {open ? (
        <a class="btn btn-sm" href={`/termine/${event.id}`}>
          {f.count == null ? t`Register` : t`Change`}
        </a>
      ) : null}
    </div>
  );
}

/** Registration per family on the event page: one number for the whole family, anyone in it can change it. */
export function FamilyCard({ event, family, onChanged }: { event: EventSummary; family: MyFamily; onChanged: () => void }) {
  const [draft, setDraft] = useState(family.count && family.count > 0 ? family.count : family.members);
  const editable = !event.isPast && !event.cancelled;
  const alone = family.members === 1;
  const save = async (count: number) => {
    await api.put(`/events/${event.id}/family`, { count });
    invalidate("/events");
    refreshBadge();
    const persons = personsText(count);
    toast(count ? t`Registered: ${persons}.` : alone ? t`You are not coming.` : t`Saved: your family is not coming.`);
    onChanged();
  };
  const draftPersons = personsText(draft);
  const by = family.updatedBy;
  return (
    <section class="card card-body stack-sm" aria-label={alone ? t`Your registration` : t`Your family`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        {alone ? t`Your registration` : t`Your family`}
      </h2>
      {alone ? null : <div class="small muted">{family.label}</div>}
      <div class="row-gap">
        <span class={`pill ${family.count ? "pill-yes" : "pill-muted"}`}>{familyState(family)}</span>
      </div>
      {editable ? (
        <>
          <div class="row-gap" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{alone ? t`How many are coming, including you?` : t`How many are coming?`}</strong>
            <div class="stepper" role="group" aria-label={t`People`}>
              <button type="button" class="icon-btn" aria-label={t`Fewer`} disabled={draft <= 1} onClick={() => setDraft(draft - 1)}>
                −
              </button>
              <span class="stepper-value" aria-live="polite">
                {draft}
              </span>
              <button type="button" class="icon-btn" aria-label={t`More`} disabled={draft >= 30} onClick={() => setDraft(draft + 1)}>
                +
              </button>
            </div>
          </div>
          {alone ? (
            <p class="small muted" style={{ margin: 0 }}>
              <Trans>You count yourself, e.g. 2 with your partner.</Trans>
            </p>
          ) : null}
          <div class="btn-row">
            {family.count !== draft ? (
              <Button variant="primary" icon="check" onClick={() => save(draft)}>
                {family.count ? t`Change to ${draft}` : t`Register: ${draftPersons}`}
              </Button>
            ) : null}
            {family.count !== 0 ? <Button onClick={() => save(0)}>{alone ? t`I'm not coming` : t`We're not coming`}</Button> : null}
          </div>
        </>
      ) : null}
      {alone ? null : (
        <p class="small muted" style={{ margin: 0 }}>
          <Trans>Counts once for the whole family. Anyone in the family can change the number.</Trans>
          {by ? ` ${t`Last changed by ${by}`}` : ""}
        </p>
      )}
    </section>
  );
}

/** Registration per family: numbers and registered families for coaches, admins and organisers. */
export function FamilyOverviewCard({ families }: { families: FamilyOverview }) {
  const registered = families.registered;
  return (
    <>
      <div class="stat-tiles" role="group" aria-label={t`Registrations`}>
        <div class="stat-tile yellow">
          <div class="n">{families.persons}</div>
          <div class="l">
            <Trans>people</Trans>
          </div>
        </div>
        <div class="stat-tile">
          <div class="n">{registered}</div>
          <div class="l">{plural(registered, { one: "family", other: "families" })}</div>
        </div>
        <div class="stat-tile">
          <div class="n">{families.declined}</div>
          <div class="l">
            <Trans>not coming</Trans>
          </div>
        </div>
        <div class="stat-tile dark">
          <div class="n">{families.open}</div>
          <div class="l">
            <Trans>no answer</Trans>
          </div>
        </div>
      </div>
      <section class="card card-body" aria-label={t`Registered families`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          {plural(registered, { one: "Registered · # family", other: "Registered · # families" })}
        </h2>
        {families.units.length ? (
          <ul class="list">
            {families.units.map((u) => (
              <li class="list-row">
                <span class="main">
                  <span class="title">{u.label}</span>
                </span>
                <strong>{u.count}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p class="small muted">
            <Trans>No family has registered yet.</Trans>
          </p>
        )}
      </section>
    </>
  );
}

/** Optional attendance: who said yes, for organisers without coach rights. */
export function OptionalYesCard({ event }: { event: EventDetail }) {
  const names = event.optionalYes ?? [];
  return (
    <section class="card card-body" aria-label={t`Accepted`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Accepted</Trans> · {names.length}
      </h2>
      {names.length ? (
        <div class="chips">
          {names.map((n) => (
            <span class="chip">{n}</span>
          ))}
        </div>
      ) : (
        <p class="small muted">
          <Trans>Nobody has said yes yet.</Trans>
        </p>
      )}
      <p class="small muted">
        <Trans>You see this as an organiser.</Trans>
      </p>
    </section>
  );
}
