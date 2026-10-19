import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
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
 * Create an event. From within a team: a game without handball4all (friendly,
 * tournament) or a special event. Under Administration only special events (also for several teams).
 */
export function SpecialEventPage({ id }: { id?: string }) {
  useDocumentTitle(t`Create event`);
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
  // From within a team it is preselected, likewise if there is only one
  const [teamIds, setTeamIds] = useState<number[]>(
    id ? [Number(id)] : teams.length === 1 ? [teams[0]!.id] : [],
  );
  const [clubWide, setClubWide] = useState(false);
  const [blocks, setBlocks] = useState<NewBlock[]>([]);
  // Groups only have special events
  const isGroup = !!id && me.groupIds.includes(Number(id));

  return (
    <main class="page">
      <TopBar
        title={kind === "game" ? t`Create game` : t`Special event`}
        kicker={clubWide ? t`Whole club` : t`Create event`}
        back={id ? `/team/${id}` : "/verwaltung/sondertermine"}
      />
      <div class="content">
        {isGroup ? (
          <p class="small muted">
            <Trans>E.g. a meeting or a training course. All members of the group are invited and accept or decline.</Trans>
          </p>
        ) : null}
        {id && !isGroup ? (
          <>
            <Segmented<NewKind>
              label={t`Kind of event`}
              value={kind}
              onChange={setKind}
              options={[
                { value: "game", label: t`Game` },
                { value: "special", label: t`Special event` },
              ]}
            />
            <p class="small muted">
              {kind === "game"
                ? t`A game that is not on handball4all, e.g. a friendly or a tournament. With squad, meeting point and helper duties like every game.`
                : t`E.g. a photo shoot, a party or a parents' evening. Everyone in the team is invited and accepts or declines.`}
            </p>
          </>
        ) : null}
        {kind === "game" && id ? (
          <NewGameForm teamId={Number(id)} locations={locs?.locations ?? []} />
        ) : null}
        {kind === "special" ? (
          <>
            <TextField
              label={t`Title`}
              value={title}
              onInput={setTitle}
              maxLength={80}
              placeholder={t`e.g. end of season, tournament, photo shoot`}
            />
            <Field label={t`Date`}>
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
              <Field label={t`Start`}>
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
              <Field label={t`End (optional)`}>
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
            <Field label={t`Location (optional)`}>
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
                  <option value="">{t`No location`}</option>
                  {(locs?.locations ?? []).map((l) => (
                    <option value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t`Info (optional)`}>
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
                    label={t`For the whole club`}
                    sub={t`All players of all teams`}
                    checked={clubWide}
                    onChange={setClubWide}
                  />
                </li>
              </ul>
            ) : null}
            {!clubWide && teams.length ? (
              <div class="field" role="group" aria-label={t`Teams`}>
                <span class="field-label">
                  <Trans>Teams</Trans>
                </span>
                {teams.length > 1 ? (
                  <span class="field-hint">
                    <Trans>Several possible</Trans>
                  </span>
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
                  toast(t`The end must be after the start.`, "error");
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
                  // Time slots follow the date of the event (the date may have been changed after the slots were created)
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
                toast(t`Event created. Everyone involved has been notified.`);
                route(`/termine/${event.id}`, true);
              }}
            >
              <Trans>Create event</Trans>
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
        label={t`Opponent or tournament`}
        value={opponent}
        onInput={setOpponent}
        maxLength={80}
        placeholder={t`e.g. HSG Musterstadt`}
      />
      <Segmented<"home" | "away">
        label={t`Home or away`}
        value={where}
        onChange={setWhere}
        options={[
          { value: "home", label: t`Home game` },
          { value: "away", label: t`Away` },
        ]}
      />
      <div class="grid-2">
        <Field label={t`Date`}>
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
        <Field label={t`Start of play`}>
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
      <Field label={t`Hall (optional)`}>
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
            <option value="">{t`No hall given`}</option>
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
          toast(t`Game created. The team has been notified.`);
          route(`/termine/${res.id}`, true);
        }}
      >
        <Trans>Create game</Trans>
      </Button>
    </>
  );
}

/**
 * "Helpers needed" when creating a special event: time slots by hand, "+ Follow-on"
 * (same duty, same duration, directly after) and "Apply from template".
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
    const count = added.length;
    toast(plural(count, { one: "# time slot applied.", other: "# time slots applied." }));
  };

  return (
    <section class="stack-sm" aria-label={t`Helpers needed`}>
      <ul class="list">
        <li>
          <SwitchRow
            label={t`Helpers needed`}
            sub={t`Time slots appear in the Helpers tab, where parents or players sign up.`}
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
            <ul class="list" aria-label={t`Time slots`}>
              {sorted.map((b) => {
                const task = b.startsAt === b.endsAt;
                const slots = b.slots;
                const label = b.label;
                const at = timeOf(b.startsAt);
                return (
                  <li class="list-row">
                    <span class="main">
                      <span class="title">
                        {task ? t`Task` : `${timeOf(b.startsAt)}–${timeOf(b.endsAt)}`} · {b.label}
                      </span>
                      <span class="sub">
                        {task ? "" : `${durationLabel(minutesBetween(b.startsAt, b.endsAt))} · `}
                        {plural(slots, { one: "# slot", other: "# slots" })}
                        {b.newTypeName ? ` · ${t`Special duty`}` : ""}
                      </span>
                    </span>
                    <button type="button" class="icon-btn icon-btn-sm" aria-label={t`Remove ${label} ${at}`} onClick={() => onChange(blocks.filter((x) => x !== b))}>
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="small muted">
              <Trans>No time slots yet.</Trans>
            </p>
          )}
          <div class="btn-row">
            <Button size="sm" variant="dashed" icon="plus" onClick={() => setAdding(true)}>
              <Trans>Time slot</Trans>
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
                <Trans>Follow-on</Trans>
              </Button>
            ) : null}
          </div>
          {templates.data?.templates.length ? (
            <div class="duty-template-apply">
              <Field label={t`Apply from template`}>
                {(fid) => (
                  <select id={fid} class="select" value={templateId} onChange={(e) => setTemplateId((e.target as HTMLSelectElement).value)}>
                    <option value="">{t`– Choose template –`}</option>
                    {templates.data!.templates.map((t) => (
                      <option value={String(t.id)}>{t.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Button size="sm" disabled={!templateId || !types.data} onClick={applyTemplate}>
                <Trans>Apply</Trans>
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
