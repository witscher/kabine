// "Manage duties" of one event: time slots, templates, entries, signing someone up. Opened from the Helpers tab
// (modules/duties/app/helpers.tsx) and from the event page ("Manage helper duties"), so it lives in the core.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "./api";
import { BlockEditSheet, BlockSheet, blockTime, type HelperFrom, helperFromText, type TemplateInfo } from "./duty-blocks";
import { dayOfMonth, time, weekdayShort } from "./format";
import { Icon } from "./icons";
import { useQuery, useSearch } from "./store";
import { Button, confirmDialog, Field, Sheet, SwitchRow, TextField, toast } from "./ui";

export interface DutyEntry {
  id: number;
  name: string;
  child: string | null;
  note: string | null;
  mine: boolean;
  forMyChild: boolean;
}

export interface DutyRole {
  childId: number | null;
  childName: string | null;
  /** The child does the duty itself (help out) */
  doer?: boolean;
}

/** Time slot of a duty at an event */
export interface DutyBlock {
  id: number;
  dutyTypeId: number;
  label: string;
  mode: "onsite" | "task";
  /** Taken by approved people from all teams (e.g. youth referee): signed up in that list */
  referee: boolean;
  special: boolean;
  startsAt: string;
  endsAt: string;
  total: number;
  noteAllowed: boolean;
  needsSkill: boolean;
  /** Prior knowledge approved by an admin */
  skillByAdmin?: boolean;
  skillMissing: boolean;
  /** Assigned by the coach: whoever does not manage does not sign up themselves */
  assignOnly?: boolean;
  /** Adults only */
  adultsOnly?: boolean;
  /** "Helpers from": certain teams or taking turns */
  helperFrom?: HelperFrom | null;
  /** As whom one can sign up (empty: not at all) */
  roles: DutyRole[];
  entries: DutyEntry[];
}

export interface DutyGame {
  id: number;
  kind: "game" | "special";
  startsAt: string;
  endsAt: string | null;
  isPast: boolean;
  isHome: boolean | null;
  homeTeam: string | null;
  guestTeam: string | null;
  title: string | null;
  location: string | null;
  cancelled: boolean;
  hidden: boolean;
  manual: boolean;
  blocks: DutyBlock[];
  /** Team of the event (lists across teams and several teams) */
  teamName?: string;
  teamId?: number;
  /** Club event (the whole club, no team) */
  club?: boolean;
  canManage?: boolean;
}

export function opponent(g: DutyGame): string {
  if (g.kind === "special") return g.title ?? t`Event`;
  if (g.isHome === true) {
    const guest = g.guestTeam ?? t`Opponent`;
    return t`vs ${guest}`;
  }
  if (g.isHome === false) {
    const home = g.homeTeam ?? t`Opponent`;
    return t`at ${home}`;
  }
  return g.title ?? `${g.homeTeam ?? "?"} – ${g.guestTeam ?? "?"}`;
}

export function eventLine(g: DutyGame) {
  const title = opponent(g);
  const weekday = weekdayShort(g.startsAt);
  const day = dayOfMonth(g.startsAt);
  const clock = time(g.startsAt);
  return t`${title}, ${weekday} ${day} at ${clock}`;
}

/** "for Anna": entry made for a child */
export function forChild(child: string): string {
  return t`for ${child}`;
}

interface PersonOption {
  personId: number;
  name: string;
  childId: number | null;
  childName: string | null;
  teams?: string | null;
}

/**
 * Sign someone up: without a search the team's people, from 2 characters the whole club. Otherwise a name without
 * access. For duties the coach assigns, adults only and "helpers from" the server lists only who fits the block.
 */
function OnBehalfPicker({ game, blocks, onDone }: { game: DutyGame; blocks: DutyBlock[]; onDone: () => void }) {
  const [blockId, setBlockId] = useState(String(blocks[0]?.id ?? ""));
  const selected = blocks.find((b) => String(b.id) === blockId) ?? blocks[0];
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const referee = !!selected?.referee;
  const rules = !!selected && (!!selected.assignOnly || !!selected.adultsOnly || !!selected.helperFrom);
  const team = useQuery<{ people: PersonOption[] }>(
    referee ? `/duties/qualified/${selected!.dutyTypeId}/people` : `/duties/events/${game.id}/people${rules ? `?block=${selected!.id}` : ""}`,
  );
  const club = useSearch<{ people: PersonOption[] }>(`/duties/events/${game.id}/people/search`, !referee && q.length >= 2 ? { q, ...(rules ? { blockId: selected!.id } : {}) } : null);
  const needle = search.trim().toLowerCase();
  const name = search.trim();
  const list: PersonOption[] =
    !referee && q.length >= 2 ? (club.data?.people ?? []) : (team.data?.people ?? []).filter((p) => !needle || `${p.name} ${p.childName ?? ""}`.toLowerCase().includes(needle));
  const add = async (body: Record<string, unknown>) => {
    try {
      await api.post("/duties", { blockId: selected!.id, ...body });
      toast(t`Signed up.`);
      setSearch("");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };
  return (
    <section class="stack-sm" aria-label={t`Sign someone up`}>
      <strong>
        <Trans>Sign someone up</Trans>
      </strong>
      <Field label={t`Duty`}>
        {(id) => (
          <select id={id} class="select" value={String(selected?.id ?? "")} onChange={(e) => setBlockId((e.target as HTMLSelectElement).value)}>
            {blocks.map((b) => (
              <option value={String(b.id)}>
                {b.label} · {blockTime(b, game.startsAt)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <TextField
        label={referee ? t`Search approved people` : t`Search name`}
        value={search}
        onInput={setSearch}
        maxLength={60}
        hint={
          referee
            ? t`Only people approved for this duty.`
            : selected?.assignOnly
              ? t`Only people who fit “who helps” of this duty. From 2 letters: the whole club.`
              : t`Without input: people of the team. From 2 letters: everyone in the club.`
        }
      />
      <ul class="list" aria-label={t`People`}>
        {list.slice(0, 30).map((p) => (
          <li>
            <button type="button" class="list-row" onClick={() => add({ onBehalfPersonId: p.personId, childId: p.childId })}>
              <span class="main">
                <span class="title">{p.name}</span>
                {p.childName || p.teams ? <span class="sub">{p.childName ? forChild(p.childName) : p.teams}</span> : null}
              </span>
              <Icon name="plus" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {needle && !list.length && !(club.data == null && q.length >= 2) ? (
        <p class="small muted">
          <Trans>No one found.</Trans>
        </p>
      ) : null}
      {!referee && search.trim() ? (
        <Button size="sm" variant="ghost" onClick={() => add({ manualName: search.trim() })}>
          <Trans>Add “{name}” as a name without access</Trans>
        </Button>
      ) : null}
    </section>
  );
}

/** Manage the duties of an event; also on the event page (startAdding: without blocks straight to "Add time slot"). */
export function ManageSheet({
  game,
  refereeView,
  onClose,
  onDone,
  startAdding = false,
}: {
  game: DutyGame;
  refereeView: boolean;
  onClose: () => void;
  onDone: () => void;
  startAdding?: boolean;
}) {
  const [sub, setSub] = useState<"main" | "add" | { edit: DutyBlock }>(startAdding ? "add" : "main");
  const templates = useQuery<{ templates: TemplateInfo[] }>(game.kind === "special" ? "/duty-templates" : null);
  const [templateId, setTemplateId] = useState("");
  const date = game.startsAt.slice(0, 10);

  const patchBlock = async (b: DutyBlock, body: Record<string, unknown>) => {
    try {
      await api.patch(`/duties/blocks/${b.id}`, body);
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  if (sub === "add") {
    // Suggestion: right after the last on-site block, otherwise at the start of the event
    const lastEnd = game.blocks.filter((b) => b.mode === "onsite" && !b.referee).reduce<string | null>((m, b) => (m == null || b.endsAt > m ? b.endsAt : m), null);
    const start = (lastEnd && lastEnd.slice(0, 10) === date ? lastEnd : game.startsAt).slice(11, 16);
    return (
      <BlockSheet
        date={date}
        start={start}
        eventEnd={game.endsAt}
        allowNewType={game.kind === "special"}
        onClose={() => setSub("main")}
        onSave={async (nb) => {
          await api.post(`/duties/events/${game.id}/blocks`, {
            ...(nb.newTypeName ? { newTypeName: nb.newTypeName } : { dutyTypeId: nb.dutyTypeId }),
            startsAt: nb.startsAt,
            endsAt: nb.endsAt,
            slots: nb.slots,
            ...(nb.helperMode ? { helperMode: nb.helperMode, helperTeams: nb.helperTeams } : {}),
          });
          const label = nb.label;
          toast(t`Time slot ${label} added.`);
          onDone();
        }}
      />
    );
  }
  if (typeof sub === "object") {
    return (
      <BlockEditSheet
        block={sub.edit}
        onClose={() => setSub("main")}
        onSave={async (v) => {
          await api.patch(`/duties/blocks/${sub.edit.id}`, v);
          onDone();
        }}
      />
    );
  }

  const blocks = refereeView ? game.blocks.filter((b) => b.referee) : game.blocks;
  return (
    <Sheet open onClose={onClose} title={t`Manage duties`}>
      <p class="muted">{eventLine(game)}</p>
      <section class="stack-sm" aria-label={t`Time slots`}>
        {blocks.map((b) => {
          const label = b.label;
          const from = helperFromText(b.helperFrom);
          return (
            <div class="duty-block-row">
              <button type="button" class="duty-block-label" aria-label={t`${label}: change`} disabled={b.referee} onClick={() => setSub({ edit: b })}>
                <strong>{b.label}</strong>
                <span class="small muted">
                  {blockTime(b, game.startsAt)}
                  {from ? ` · ${from}` : ""}
                </span>
                {b.helperFrom?.conflict ? <span class="small duty-conflict">{b.helperFrom.conflict}</span> : null}
              </button>
              <div class="duty-stepper-inline">
                <button
                  type="button"
                  class="icon-btn icon-btn-sm"
                  aria-label={t`${label}: one slot fewer`}
                  disabled={b.total <= 0}
                  onClick={() => patchBlock(b, { slots: b.total - 1 })}
                >
                  −
                </button>
                <strong aria-live="polite">{b.total}</strong>
                <button
                  type="button"
                  class="icon-btn icon-btn-sm"
                  aria-label={t`${label}: one slot more`}
                  disabled={b.total >= 20}
                  onClick={() => patchBlock(b, { slots: b.total + 1 })}
                >
                  +
                </button>
              </div>
              {!b.referee ? (
                <button
                  type="button"
                  class="icon-btn icon-btn-sm"
                  aria-label={t`Remove ${label}`}
                  onClick={async () => {
                    // With entries: they go with the block, without a notification (as when removing a single entry)
                    const n = b.entries.length;
                    const message =
                      n > 0
                        ? plural(n, {
                            one: "The time slot is only removed from this event. # entry is removed with it, without a notification.",
                            other: "The time slot is only removed from this event. # entries are removed with it, without a notification.",
                          })
                        : t`The time slot is only removed from this event.`;
                    if (!(await confirmDialog({ title: t`Remove ${label}?`, message, confirmLabel: t`Remove`, danger: true }))) return;
                    try {
                      await api.del(`/duties/blocks/${b.id}`);
                      onDone();
                    } catch (err) {
                      toast(errorMessage(err), "error");
                    }
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
        {!blocks.length ? (
          <p class="small muted">
            <Trans>No duties yet.</Trans>
          </p>
        ) : null}
        {!refereeView ? (
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setSub("add")}>
            <Trans>Add time slot</Trans>
          </Button>
        ) : null}
        {game.kind === "special" && templates.data?.templates.length ? (
          <div class="duty-template-apply">
            <Field label={t`Apply from template`}>
              {(id) => (
                <select id={id} class="select" value={templateId} onChange={(e) => setTemplateId((e.target as HTMLSelectElement).value)}>
                  <option value="">{t`– Choose template –`}</option>
                  {templates.data!.templates.map((tpl) => (
                    <option value={String(tpl.id)}>{tpl.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              size="sm"
              disabled={!templateId}
              onClick={async () => {
                const res = await api.post<{ created: number }>(`/duties/events/${game.id}/apply-template`, { templateId: Number(templateId) });
                const created = res.created;
                toast(
                  plural(created, {
                    one: "# time slot applied.",
                    other: "# time slots applied.",
                  }),
                );
                setTemplateId("");
                onDone();
              }}
            >
              <Trans>Apply</Trans>
            </Button>
          </div>
        ) : null}
      </section>
      <section class="stack-sm" aria-label={t`Entries`}>
        <strong>
          <Trans>Entries</Trans>
        </strong>
        <ul class="list">
          {blocks.flatMap((b) =>
            b.entries.map((e) => (
              <li class="list-row">
                <span class="main">
                  <span class="title">{e.name}</span>
                  {/* With the block's time, so entries of two shifts of the same duty can be told apart */}
                  <span class="sub">
                    {b.label} · {blockTime(b, game.startsAt)}
                    {e.child ? ` · ${forChild(e.child)}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.del(`/duties/${e.id}`);
                    onDone();
                  }}
                >
                  <Trans>Remove</Trans>
                </Button>
              </li>
            )),
          )}
        </ul>
        {!blocks.some((b) => b.entries.length) ? (
          <p class="small muted">
            <Trans>No one signed up yet.</Trans>
          </p>
        ) : null}
      </section>
      {blocks.length ? <OnBehalfPicker game={game} blocks={blocks} onDone={onDone} /> : null}
      {game.kind === "game" && !refereeView ? (
        <SwitchRow
          label={t`Hide in helper plan`}
          sub={t`Parents then don't see the game, e.g. for a game without catering.`}
          checked={game.hidden}
          onChange={async (hidden) => {
            await api.patch(`/duties/games/${game.id}`, { hidden });
            onDone();
          }}
        />
      ) : null}
      {game.manual && !refereeView ? (
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            await api.del(`/duties/games/${game.id}`);
            toast(t`Game deleted.`);
            onClose();
            onDone();
          }}
        >
          <Trans>Delete game</Trans>
        </Button>
      ) : null}
    </Sheet>
  );
}

/**
 * "Manage helper duties" on the event page: the same sheet as in the Helpers tab. Without blocks it starts with "Add
 * time slot" and returns to the sheet afterwards, so organisers add all blocks in a row.
 */
export function EventDutyManager({ eventId, onClose, onChanged }: { eventId: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useQuery<DutyGame>(`/duties/events/${eventId}/manage`);
  const [first] = useState(() => ({ checked: false, empty: false }));
  useEffect(() => {
    if (!error) return;
    toast(errorMessage(error), "error");
    onClose();
  }, [error]);
  if (!data) return null;
  if (!first.checked) {
    first.checked = true;
    first.empty = data.blocks.length === 0;
  }
  return (
    <ManageSheet
      game={data}
      refereeView={false}
      startAdding={first.empty}
      onClose={onClose}
      onDone={() => {
        void reload();
        onChanged();
      }}
    />
  );
}
