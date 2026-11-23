// Pages of the polls module: list, create and edit (with preview), vote and result, managing, payment.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { renderSVG } from "uqr";
import { api } from "../../../src/api";
import { intlTag } from "../../../shared/dates";
import { addDays, fullDate, todayLocal } from "../../../src/format";
import { currentLocale } from "../../../src/i18n";
import { Icon } from "../../../src/icons";
import { useMe } from "../../../src/session";
import { useQuery } from "../../../src/store";
import { Button, confirmDialog, copyText, Empty, ErrorBox, Field, InfoButton, Notice, Segmented, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../../../src/ui";
import {
  type PaymentAmounts,
  type PollAnswer,
  type PollDetail,
  type PollKind,
  type PollOption,
  type PollOrder,
  type PollPayment,
  type PollSummary,
  type PollTeamInfo,
  type PollUnit,
  epcPayload,
  paymentState,
} from "../types";
import { moneyFormat, orderFilename, orderSheets } from "../shared/order-export";
import { XLSX_MIME, xlsx } from "../shared/xlsx";
import { endsText, openLabel, formatMoney, hintSeen, kindLabel, ORDER_HINT, optionLabel, pollsChanged, rememberHint, slotLabel, teamText, useInfoSheet } from "./common";
import { anonymousHelp, familyHelp, resultsHelp } from "./help";
import { shrinkImage } from "./shrink";

// List ----------------------------------------------------------------------------------------------

/** /umfragen: the person's polls; ?team=<id> those of a team, ?verein those of the whole club (admins). */
export function PollsPage() {
  useDocumentTitle(t`Polls`);
  const me = useMe();
  const { query } = useLocation();
  const teamId = query.team ? Number(query.team) : null;
  const club = query.verein != null;
  const path = teamId ? `/polls?teamId=${teamId}` : club ? "/polls?teamId=club" : "/polls";
  const { data, error, loading, reload } = useQuery<{ polls: PollSummary[] }>(path);
  const team = teamId ? me.manageableTeams.find((x) => x.id === teamId) : null;
  const canCreate = teamId ? !!team : club ? me.isAdmin : me.isAdmin || me.manageableTeams.length > 0;
  const polls = data?.polls ?? [];
  const running = polls.filter((p) => p.open);
  const ended = polls.filter((p) => !p.open);
  const newHref = teamId ? `/umfragen/neu?team=${teamId}` : club ? "/umfragen/neu?verein" : "/umfragen/neu";
  return (
    <main class="page">
      <TopBar title={t`Polls`} kicker={team ? team.name : club ? t`Whole club` : undefined} back={club ? "/verwaltung/umfragen" : "/profil"} />
      <div class="content">
        {canCreate ? (
          <a class="btn btn-primary" href={newHref}>
            <Icon name="plus" size={18} />
            <Trans>Create poll</Trans>
          </a>
        ) : null}
        {loading ? <Spinner /> : null}
        {error ? <ErrorBox error={error} onRetry={reload} /> : null}
        {data && !polls.length ? (
          <Empty title={t`No polls`} icon="poll">
            {canCreate ? t`Ask for a date or an opinion, or collect orders.` : t`Polls of your teams appear here.`}
          </Empty>
        ) : null}
        {running.length ? <PollList title={t`Running`} polls={running} /> : null}
        {ended.length ? <PollList title={t`Ended`} polls={ended} /> : null}
      </div>
    </main>
  );
}

function PollList({ title, polls }: { title: string; polls: PollSummary[] }) {
  return (
    <section class="stack-sm">
      <h2 class="section-title">{title}</h2>
      <ul class="list">
        {polls.map((p) => {
          const voted = p.voted;
          const total = p.total;
          return (
            <li>
              <a class="list-row" href={`/umfragen/${p.id}`}>
                <Icon name="poll" size={22} />
                <span class="main">
                  <span class="title">{p.title}</span>
                  <span class="sub">
                    {kindLabel(p.kind)} · {teamText(p.teamName)} · {endsText(p.endsAt, p.open)}
                    {p.canManage ? ` · ${t`${voted} of ${total} voted`}` : ""}
                  </span>
                </span>
                {p.open && p.openUnits ? (
                  p.ignored ? (
                    <span class="pill pill-muted">
                      <Trans>Hidden</Trans>
                    </span>
                  ) : (
                    <span class="pill pill-nominated">
                      {openLabel()}
                    </span>
                  )
                ) : null}
                <Icon name="chevron" size={18} />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Create and edit -----------------------------------------------------------------------------------

interface DraftOption {
  /** Existing option (editing) */
  id?: number;
  label: string;
  date: string;
  time: string;
  price: string;
  sizes: string;
  /** Orders: saved photo, newly chosen one (shrunk) and whether to remove it */
  imageUrl?: string | null;
  image?: Blob | null;
  imagePreview?: string | null;
  removeImage?: boolean;
}

/** The photo that applies in the draft */
const draftImage = (o: DraftOption): string | null => o.imagePreview ?? (o.removeImage ? null : (o.imageUrl ?? null));

const emptyOption = (date = ""): DraftOption => ({ label: "", date, time: "", price: "", sizes: "" });

/** "8,50", "8.50", "8 €" → cents; null if it is no price. */
export function parsePrice(s: string): number | null {
  const v = s.trim().replace(/[^\d.,]/g, "").replace(",", ".");
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

function priceText(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function PollNewPage() {
  useDocumentTitle(t`Create poll`);
  const { query } = useLocation();
  return <PollForm teamId={query.team ? Number(query.team) : query.verein != null ? null : undefined} />;
}

/** Edit a poll: creator and admins (the server checks). */
export function PollEditPage({ id }: { id: string }) {
  useDocumentTitle(t`Edit poll`);
  const { data, error, reload } = useQuery<PollDetail>(`/polls/${id}`);
  if (error)
    return (
      <main class="page">
        <TopBar title={t`Edit poll`} back={`/umfragen/${id}`} />
        <div class="content">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      </main>
    );
  if (!data) return <Spinner />;
  return <PollForm teamId={data.poll.teamId} edit={data} />;
}

function toDraft(o: PollOption): DraftOption {
  const s = o.startsAt ?? "";
  return {
    id: o.id,
    label: o.label,
    date: s.slice(0, 10),
    time: s.length > 10 ? s.slice(11, 16) : "",
    price: o.priceCents != null ? priceText(o.priceCents) : "",
    sizes: o.sizes.join(", "),
    imageUrl: o.imageUrl,
  };
}

/** teamId undefined: not chosen yet (the form offers the teams the person manages and, for admins, the whole club). */
function PollForm({ teamId: given, edit }: { teamId: number | null | undefined; edit?: PollDetail }) {
  const me = useMe();
  const { route } = useLocation();
  const p = edit?.poll;
  const choices = [...(me.isAdmin ? [{ id: 0, name: t`Whole club` }] : []), ...me.manageableTeams];
  const [picked, setPicked] = useState<number | null>(given !== undefined ? given : (choices[0]?.id ?? null) || null);
  const teamId = given !== undefined ? given : picked;
  const team = teamId ? me.manageableTeams.find((x) => x.id === teamId) : null;
  const isGroup = !!teamId && me.groupIds.includes(teamId);
  const { data: info } = useQuery<PollTeamInfo>(teamId ? `/polls/teams/${teamId}` : null);
  // When editing without coach rights (creator who is no longer coach): parents as before
  const parentsPossible = teamId ? (info?.parentsEnabled ?? !!p?.whoParents) : true;
  const [kind, setKind] = useState<PollKind>(p?.kind ?? "choice");
  const [title, setTitle] = useState(p?.title ?? "");
  const [description, setDescription] = useState(p?.description ?? "");
  const [options, setOptions] = useState<DraftOption[]>(edit ? edit.options.map(toDraft) : [emptyOption(), emptyOption()]);
  const [multiple, setMultiple] = useState(p?.multiple ?? false);
  const [whoPlayers, setWhoPlayers] = useState(p?.whoPlayers ?? true);
  const [whoParents, setWhoParents] = useState(p?.whoParents ?? false);
  const [whoCoaches, setWhoCoaches] = useState(p?.whoCoaches ?? false);
  const [perFamily, setPerFamily] = useState(p?.perFamily ?? false);
  const [anonymous, setAnonymous] = useState(p?.anonymous ?? false);
  const [results, setResults] = useState<"always" | "after">(p?.results ?? "always");
  const [endDate, setEndDate] = useState(p ? p.endsAt.slice(0, 10) : addDays(todayLocal(), 7));
  const [endTime, setEndTime] = useState(p ? p.endsAt.slice(11, 16) : "20:00");
  const [preview, setPreview] = useState(false);
  // With votes: what would reinterpret votes or reveal names stays fixed
  const voted = edit?.voted ?? 0;
  const locked = voted > 0;

  // Scheduling and orders mostly per family (only when creating)
  useEffect(() => {
    if (edit) return;
    if (kind === "order") setAnonymous(false);
    setPerFamily(kind !== "choice" && !isGroup);
    setOptions((o) => {
      if (kind === "schedule") return o.map((x, i) => ({ ...x, date: x.date || addDays(todayLocal(), 14 + i * 7) }));
      // Orders start with one row, empty rows are dropped; a choice needs at least two answers
      if (kind === "order") {
        const filled = o.filter((x) => x.label.trim() || x.price.trim() || x.sizes.trim() || x.image);
        return filled.length ? filled : [emptyOption()];
      }
      return o.length >= 2 ? o : [...o, ...Array.from({ length: 2 - o.length }, () => emptyOption())];
    });
  }, [kind]);

  const setOption = (i: number, patch: Partial<DraftOption>) => setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const back = edit ? `/umfragen/${edit.poll.id}` : given ? `/umfragen?team=${given}` : given === null ? "/umfragen?verein" : "/umfragen";
  const memberLabel = isGroup ? t`Members` : t`Players`;
  const coachLabel = isGroup ? t`Leads` : t`Coaches`;
  const optionsLabel = kind === "choice" ? t`Answers` : kind === "schedule" ? t`Dates` : t`Items`;

  const draftOptions = () =>
    options.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      label: o.label.trim(),
      startsAt: kind === "schedule" ? (o.time ? `${o.date}T${o.time}` : o.date) : null,
      priceCents: kind === "order" ? parsePrice(o.price) : null,
      sizes:
        kind === "order"
          ? o.sizes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
    }));

  const submit = async () => {
    const opts = draftOptions();
    if (kind === "order" && opts.some((o) => o.priceCents == null)) {
      toast(t`Please enter a price for every item, e.g. 8.50.`, "error");
      return;
    }
    const body = {
      teamId,
      kind,
      title: title.trim(),
      description: description.trim() || null,
      multiple,
      anonymous,
      results,
      perFamily,
      whoPlayers,
      whoParents: whoParents && parentsPossible && !isGroup,
      whoCoaches,
      endsAt: `${endDate}T${endTime}`,
      options: opts,
    };
    // Product photos after saving: only then the items have their ids (same order as in the form)
    const syncImages = async (pollId: number, saved: PollOption[]) => {
      let failed = false;
      for (const [i, o] of options.entries()) {
        const target = saved[i];
        if (!target) continue;
        try {
          if (o.image) await api.upload(`/polls/${pollId}/options/${target.id}/image`, o.image);
          else if (o.removeImage && o.imageUrl) await api.del(`/polls/${pollId}/options/${target.id}/image`);
        } catch {
          failed = true;
        }
      }
      if (failed) toast(t`A photo could not be saved. Try again with “Edit poll”.`, "error");
    };
    const hasImageChanges = kind === "order" && options.some((o) => o.image || (o.removeImage && o.imageUrl));
    if (edit) {
      const saved = await api.put<PollDetail>(`/polls/${edit.poll.id}`, body);
      if (hasImageChanges) await syncImages(edit.poll.id, saved.options);
      pollsChanged();
      toast(t`Poll saved.`);
      route(`/umfragen/${edit.poll.id}`, true);
      return;
    }
    const res = await api.post<{ id: number }>("/polls", body);
    if (hasImageChanges) await syncImages(res.id, (await api.get<PollDetail>(`/polls/${res.id}`)).options);
    pollsChanged();
    toast(t`Poll started. Everyone who votes has been notified.`);
    route(`/umfragen/${res.id}`, true);
  };

  const kicker = edit ? teamText(p?.teamName ?? null) : team ? team.name : teamId === null ? t`Whole club` : undefined;
  return (
    <main class="page">
      <TopBar title={edit ? t`Edit poll` : t`Create poll`} kicker={kicker} back={back} />
      <div class="content">
        {locked ? (
          <Notice kind="warn" icon="alert">
            {plural(voted, { one: "There is one vote already.", other: "There are # votes already." })}{" "}
            <Trans>
              If you change an answer, its votes still count, even if it then means something else. If you remove an answer, its votes are lost; whoever had
              chosen only that one votes again.
            </Trans>{" "}
            {kind === "choice" ? t`“Multiple answers” and “One vote per family” can no longer be switched.` : t`“One vote per family” can no longer be switched.`}
            {anonymous ? ` ${t`The poll stays anonymous.`}` : ""}
          </Notice>
        ) : null}
        {given === undefined && !edit && choices.length > 1 ? (
          <Field label={t`For`}>
            {(fid) => (
              <select id={fid} class="input" value={String(picked ?? 0)} onChange={(e) => setPicked(Number((e.target as HTMLSelectElement).value) || null)}>
                {choices.map((c) => (
                  <option value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        {edit ? null : (
          <Segmented<PollKind>
            label={t`Kind of poll`}
            value={kind}
            onChange={setKind}
            options={[
              { value: "choice", label: t`Choice` },
              { value: "schedule", label: t`Find a date` },
              { value: "order", label: t`Order` },
            ]}
          />
        )}
        <p class="small muted">
          {kind === "choice"
            ? t`A question with fixed answers, e.g. “Where shall the end-of-season trip go?”`
            : kind === "schedule"
              ? t`Several dates to choose from, everyone answers yes, maybe or no.`
              : t`Items with price and sizes, everyone says how many they want.`}
        </p>
        <TextField
          label={kind === "order" ? t`Title` : t`Question`}
          value={title}
          onInput={setTitle}
          maxLength={120}
          placeholder={kind === "choice" ? t`e.g. Where shall the trip go?` : kind === "schedule" ? t`e.g. When shall we have the summer party?` : t`e.g. Club kit autumn`}
        />
        <Field label={t`Description (optional)`}>
          {(fid) => <textarea id={fid} class="textarea" value={description} maxLength={1000} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />}
        </Field>

        <div class="field" role="group" aria-label={optionsLabel}>
          <span class="field-label">{optionsLabel}</span>
          <div class="stack-sm">
            {options.map((o, i) => {
              const n = i + 1;
              return (
                <div class="poll-option-edit">
                  {kind === "choice" ? (
                    <input class="input" aria-label={t`Answer ${n}`} value={o.label} maxLength={120} onInput={(e) => setOption(i, { label: (e.target as HTMLInputElement).value })} />
                  ) : null}
                  {kind === "schedule" ? (
                    <div class="grid-2" style={{ flex: 1 }}>
                      <input class="input" type="date" aria-label={t`Date ${n}: day`} value={o.date} onInput={(e) => setOption(i, { date: (e.target as HTMLInputElement).value })} />
                      <input class="input" type="time" aria-label={t`Date ${n}: time (optional)`} value={o.time} onInput={(e) => setOption(i, { time: (e.target as HTMLInputElement).value })} />
                    </div>
                  ) : null}
                  {kind === "order" ? (
                    <div class="stack-sm" style={{ flex: 1 }}>
                      <div class="grid-2">
                        <input class="input" aria-label={t`Item ${n}`} placeholder={t`Item, e.g. socks`} value={o.label} maxLength={120} onInput={(e) => setOption(i, { label: (e.target as HTMLInputElement).value })} />
                        <input class="input" inputMode="decimal" aria-label={t`Item ${n}: price`} placeholder={t`Price`} value={o.price} onInput={(e) => setOption(i, { price: (e.target as HTMLInputElement).value })} />
                      </div>
                      <input class="input" aria-label={t`Item ${n}: sizes (optional)`} placeholder={t`Sizes, separated by commas (optional)`} value={o.sizes} onInput={(e) => setOption(i, { sizes: (e.target as HTMLInputElement).value })} />
                      <OptionPhoto
                        index={i}
                        label={o.label}
                        src={draftImage(o)}
                        onPick={(image) => setOption(i, { image, imagePreview: URL.createObjectURL(image), removeImage: false })}
                        onRemove={() => setOption(i, { image: null, imagePreview: null, removeImage: true })}
                      />
                    </div>
                  ) : null}
                  {options.length > (kind === "order" ? 1 : 2) ? (
                    <button type="button" class="icon-btn" aria-label={t`Remove`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                      <Icon name="x" size={18} />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {options.length < 30 ? (
              <Button variant="dashed" icon="plus" onClick={() => setOptions([...options, emptyOption(kind === "schedule" ? addDays(options[options.length - 1]?.date || todayLocal(), 7) : "")])}>
                {kind === "choice" ? t`Add answer` : kind === "schedule" ? t`Add date` : t`Add item`}
              </Button>
            ) : null}
          </div>
        </div>

        {kind === "order" ? (
          <p class="small muted">
            <Trans>Photos: product photos only, no people. They are made smaller before the upload.</Trans>
          </p>
        ) : null}
        {kind === "order" ? <PaymentHint /> : null}

        <div class="field" role="group" aria-label={t`Who votes?`}>
          <span class="field-label">
            <Trans>Who votes?</Trans>
          </span>
          <div class="chips">
            <WhoChip label={memberLabel} on={whoPlayers} set={setWhoPlayers} />
            {parentsPossible && !isGroup ? <WhoChip label={t`Parents`} on={whoParents} set={setWhoParents} /> : null}
            <WhoChip label={coachLabel} on={whoCoaches} set={setWhoCoaches} />
          </div>
          {teamId === null ? (
            <span class="field-hint">
              <Trans>Whole club: all teams, without groups</Trans>
            </span>
          ) : null}
        </div>

        <ul class="list">
          {kind === "choice" ? (
            <li>
              <SwitchRow label={t`Multiple answers possible`} checked={multiple} onChange={setMultiple} disabled={locked} />
            </li>
          ) : null}
          {!isGroup ? (
            <li>
              <SwitchRow info={familyHelp()} label={t`One vote per family`} checked={perFamily} onChange={setPerFamily} disabled={locked} />
            </li>
          ) : null}
          {kind !== "order" ? (
            <li>
              <SwitchRow info={anonymousHelp()} label={t`Anonymous`} checked={anonymous} onChange={setAnonymous} disabled={locked && anonymous} />
            </li>
          ) : null}
        </ul>
        {kind === "schedule" && !anonymous ? (
          <p class="small muted">
            <Trans>Participants see who answered what (first name and initial).</Trans>
          </p>
        ) : null}

        {/* Orders: participants see only their own order, so the result setting does not apply */}
        {kind !== "order" ? (
          <div class="field">
            <span class="field-label">
              <Trans>Result</Trans> <InfoButton topic={resultsHelp()} />
            </span>
            <Segmented<"always" | "after">
              label={t`Result`}
              value={results}
              onChange={setResults}
              options={[
                { value: "always", label: t`Visible right away` },
                { value: "after", label: t`Only after the end` },
              ]}
            />
          </div>
        ) : null}

        <div class="grid-2">
          <Field label={t`Ends on`}>
            {(fid) => <input id={fid} class="input" type="date" value={endDate} min={todayLocal()} onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field label={t`at`}>
            {(fid) => <input id={fid} class="input" type="time" value={endTime} onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />}
          </Field>
        </div>

        <div class="grid-2">
          <Button size="lg" disabled={!title.trim()} onClick={() => setPreview(true)}>
            <Trans>Preview</Trans>
          </Button>
          <Button variant="primary" size="lg" disabled={!title.trim() || (!whoPlayers && !whoParents && !whoCoaches) || teamId === undefined} onClick={submit}>
            {edit ? t`Save` : t`Start poll`}
          </Button>
        </div>
      </div>
      {preview ? (
        <PollPreview
          onClose={() => setPreview(false)}
          detail={{
            poll: {
              id: 0,
              kind,
              title: title.trim(),
              description: description.trim() || null,
              teamId: teamId ?? null,
              teamName: team?.name ?? p?.teamName ?? null,
              multiple,
              anonymous: kind !== "order" && anonymous,
              results,
              perFamily,
              whoPlayers,
              whoParents,
              whoCoaches,
              endsAt: `${endDate}T${endTime}`,
              open: true,
              createdBy: null,
              createdAt: "",
              payment: null,
              currency: p?.currency ?? "EUR",
            },
            // Preview: no ids yet, negative positions serve as keys
            options: draftOptions()
              .map((o, i) => ({ ...o, imageUrl: kind === "order" ? draftImage(options[i]!) : null }))
              .filter((o) => (kind === "schedule" ? !!o.startsAt : !!o.label))
              .map((o, i) => ({ id: -(i + 1), label: o.label, startsAt: o.startsAt, priceCents: o.priceCents ?? 0, sizes: o.sizes, imageUrl: o.imageUrl })),
            canManage: false,
            canEdit: false,
            myUnits: [],
            voted: 0,
            total: 0,
            resultsVisible: false,
            tallies: null,
            pending: null,
            orders: null,
          }}
        />
      ) : null}
    </main>
  );
}

/** How voters see the poll, from the unsaved form; votes can be tried, nothing is saved. */
function PollPreview({ detail, onClose }: { detail: PollDetail; onClose: () => void }) {
  const { poll } = detail;
  const unit: PollUnit = {
    unitId: 0,
    who: poll.perFamily ? "family" : "self",
    name: "",
    answers: null,
    votedBy: null,
    updatedAt: null,
    orderNo: null,
    reference: null,
    paypalNote: null,
    payment: null,
  };
  return (
    <Sheet open onClose={onClose} title={t`Preview`}>
      <div class="stack">
        <p class="small muted">
          <Trans>This is how voters see the poll. You can try it, nothing is saved.</Trans>
        </p>
        <PollHeader detail={detail} />
        {detail.options.length ? (
          <BallotCard detail={detail} unit={unit} onSaved={() => undefined} preview />
        ) : (
          <p class="small muted">
            <Trans>No answers entered yet.</Trans>
          </p>
        )}
        {poll.kind === "order" ? (
          <p class="small muted">
            <Trans>After ordering, the payment details from Administration → Polls appear here.</Trans>
          </p>
        ) : null}
        <Button onClick={onClose}>
          <Trans>Back to editing</Trans>
        </Button>
      </div>
    </Sheet>
  );
}

/** Choose a product photo for an item (camera or gallery); it is made smaller on the device. */
function OptionPhoto({ index, label, src, onPick, onRemove }: { index: number; label: string; src: string | null; onPick: (b: Blob) => void; onRemove: () => void }) {
  const [busy, setBusy] = useState(false);
  const n = index + 1;
  const name = label.trim() || t`Item ${n}`;
  return (
    <div class="row-gap">
      {src ? <img class="poll-thumb" src={src} alt={t`Photo: ${name}`} /> : null}
      <label class={`btn btn-sm ${busy ? "is-busy" : ""}`}>
        <Icon name="camera" size={16} />
        {busy ? t`Making it smaller …` : src ? t`Change photo` : t`Photo`}
        <input
          type="file"
          accept="image/*"
          aria-label={t`${name}: choose photo`}
          style={{ display: "none" }}
          onChange={async (e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (!file) return;
            setBusy(true);
            try {
              onPick(await shrinkImage(file));
            } catch (err) {
              toast(err instanceof Error ? err.message : t`The photo could not be read.`, "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {src ? (
        <button type="button" class="icon-btn" aria-label={t`${name}: remove photo`} onClick={onRemove}>
          <Icon name="trash" size={16} />
        </button>
      ) : null}
    </div>
  );
}

function WhoChip({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" class={`chip ${on ? "selected" : ""}`} aria-pressed={on ? "true" : "false"} onClick={() => set(!on)}>
      {label}
    </button>
  );
}

// Vote and result -------------------------------------------------------------------------------------

function PollHeader({ detail }: { detail: PollDetail }) {
  const { poll } = detail;
  const by = poll.createdBy;
  return (
    <section class="stack-sm">
      <h1 class="poll-title">{poll.title}</h1>
      {poll.description ? <p class="pre-wrap">{poll.description}</p> : null}
      <p class="small muted">
        {by ? `${t`By ${by}`} · ` : ""}
        {endsText(poll.endsAt, poll.open)}
        {poll.anonymous ? ` · ${t`anonymous`}` : ""}
        {poll.perFamily ? ` · ${t`one vote per family`}` : ""}
      </p>
    </section>
  );
}

export function PollPage({ id }: { id: string }) {
  useDocumentTitle(t`Poll`);
  const { route } = useLocation();
  const { data, error, loading, reload, mutate } = useQuery<PollDetail>(`/polls/${id}`);
  if (loading && !data) return <Spinner />;
  if (error || !data) {
    return (
      <main class="page">
        <TopBar title={t`Poll`} back="/" />
        <div class="content">{error ? <ErrorBox error={error} onRetry={reload} /> : null}</div>
      </main>
    );
  }
  const { poll } = data;
  const update = (d: PollDetail) => {
    mutate(d);
    pollsChanged();
  };
  const voted = data.voted;
  const total = data.total;
  const counted =
    poll.kind === "order"
      ? poll.perFamily
        ? plural(total, { one: `${voted} of # family ordered`, other: `${voted} of # families ordered` })
        : plural(total, { one: `${voted} of # person ordered`, other: `${voted} of # people ordered` })
      : poll.perFamily
        ? plural(total, { one: `${voted} of # family voted`, other: `${voted} of # families voted` })
        : plural(total, { one: `${voted} of # person voted`, other: `${voted} of # people voted` });
  return (
    <main class="page">
      <TopBar title={kindLabel(poll.kind)} kicker={teamText(poll.teamName)} back={() => (history.length > 1 ? history.back() : route("/"))} />
      <div class="content">
        <PollHeader detail={data} />

        {data.myUnits.map((u) => (
          <BallotCard key={`${u.unitId}-${u.updatedAt ?? ""}`} detail={data} unit={u} onSaved={update} />
        ))}

        {/* Orders: totals only for creator, coaches and admins; participants see only their own order */}
        {poll.kind !== "order" || data.canManage ? (
          <section class="card card-body stack-sm" aria-label={poll.kind === "order" ? t`Quantities` : t`Result`}>
            <div class="poll-row">
              <h2 class="section-title" style={{ margin: 0 }}>
                {poll.kind === "order" ? t`Quantities` : t`Result`}
              </h2>
              <span class="small muted">{counted}</span>
            </div>
            {data.resultsVisible && data.tallies ? (
              <Results detail={data} />
            ) : (
              <p class="small muted">
                <Trans>You see the result after the end.</Trans>
              </p>
            )}
          </section>
        ) : null}

        {data.canManage ? <ManageSection detail={data} onChanged={update} onDeleted={() => route(poll.teamId ? `/umfragen?team=${poll.teamId}` : "/umfragen", true)} /> : null}
      </div>
    </main>
  );
}

function unitTitle(kind: PollKind, unit: PollUnit): string {
  if (unit.who === "self") return kind === "order" ? t`Your order` : t`Your vote`;
  if (unit.who === "family") return t`For your family`;
  const name = unit.name;
  return t`For ${name}`;
}

function BallotCard({ detail, unit, onSaved, preview }: { detail: PollDetail; unit: PollUnit; onSaved: (d: PollDetail) => void; preview?: boolean }) {
  const { poll, options } = detail;
  const money = (cents: number) => formatMoney(cents, poll.currency);
  const initial = new Map((unit.answers ?? []).map((a) => [`${a.optionId}|${a.size}`, a.value]));
  const [values, setValues] = useState(initial);
  const [editing, setEditing] = useState(unit.answers == null);
  const [photo, setPhoto] = useState<PollOption | null>(null);
  const [showInfo, infoSheet] = useInfoSheet();
  const get = (optionId: number, size = "") => values.get(`${optionId}|${size}`) ?? (poll.kind === "schedule" ? -1 : 0);
  const set = (optionId: number, size: string, value: number) => {
    const next = new Map(poll.kind === "choice" && !poll.multiple ? [] : values);
    next.set(`${optionId}|${size}`, value);
    setValues(next);
  };
  const voted = unit.answers != null;
  const canEdit = poll.open && editing;
  const answers: PollAnswer[] = [...values]
    .filter(([, v]) => v >= 0)
    .map(([k, v]) => ({ optionId: Number(k.split("|")[0]), size: k.split("|").slice(1).join("|"), value: v }));
  const total = poll.kind === "order" ? answers.reduce((s, a) => s + (options.find((o) => o.id === a.optionId)?.priceCents ?? 0) * a.value, 0) : 0;
  const complete = poll.kind === "choice" ? answers.some((a) => a.value === 1) : poll.kind === "schedule" ? options.every((o) => get(o.id) >= 0) : true;

  const save = async () => {
    if (preview) {
      toast(t`Preview only, nothing saved.`);
      return;
    }
    const d = await api.put<PollDetail>(`/polls/${poll.id}/ballot`, { unitId: unit.unitId, answers: answers.filter((a) => poll.kind === "schedule" || a.value > 0) });
    setEditing(false);
    onSaved(d);
    if (poll.kind === "order" && !hintSeen(ORDER_HINT)) {
      // Once per device: the card on the start page disappears, so say where the order stays
      rememberHint(ORDER_HINT);
      showInfo({
        title: total ? t`Order saved` : t`Saved`,
        message: t`If you change your mind: under Profile → Polls you find the order again and can change it until the poll ends.`,
      });
    } else toast(poll.kind === "order" ? t`Order saved.` : t`Vote saved.`);
  };
  const title = unitTitle(poll.kind, unit);
  const lastBy = unit.votedBy;
  const photoName = photo?.label ?? "";
  return (
    <section class="card card-body stack-sm" aria-label={title}>
      <div class="poll-row">
        <strong>{title}</strong>
        {voted ? (
          <span class={`pill ${poll.kind === "order" && !unit.answers?.length ? "pill-muted" : "pill-yes"}`}>
            <Icon name="check" size={14} />
            {poll.kind === "order" ? (unit.answers?.length ? t`Ordered` : t`Nothing ordered`) : t`Voted`}
          </span>
        ) : poll.open ? (
          <span class="pill pill-nominated">
            {openLabel()}
          </span>
        ) : null}
      </div>
      {lastBy ? (
        <p class="small muted">
          <Trans>Last changed by {lastBy}</Trans>
        </p>
      ) : null}

      {poll.kind === "choice" ? (
        <div class="stack-sm" role={poll.multiple ? "group" : "radiogroup"} aria-label={t`Answers`}>
          {poll.multiple ? (
            <span class="small muted">
              <Trans>Multiple answers possible</Trans>
            </span>
          ) : null}
          {options.map((o) => {
            const on = get(o.id) === 1;
            return (
              <button
                type="button"
                class={`poll-choice ${on ? "selected" : ""}`}
                role={poll.multiple ? "checkbox" : "radio"}
                aria-checked={on ? "true" : "false"}
                disabled={!canEdit}
                onClick={() => set(o.id, "", on && poll.multiple ? 0 : 1)}
              >
                <span class="poll-check">{on ? <Icon name="check" size={14} /> : null}</span>
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {poll.kind === "schedule" ? (
        <ul class="list">
          {options.map((o) => (
            <li class="list-row poll-slot">
              <span class="poll-slot-title">{slotLabel(o)}</span>
              <div class="poll-yesno" role="radiogroup" aria-label={slotLabel(o)}>
                {(
                  [
                    [2, t`Yes`],
                    [1, t`Maybe`],
                    [0, t`No`],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={get(o.id) === v ? "true" : "false"}
                    class={`chip ${get(o.id) === v ? "selected" : ""}`}
                    disabled={!canEdit}
                    onClick={() => set(o.id, "", v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {poll.kind === "order" ? (
        <ul class="list">
          {options.flatMap((o) =>
            // A saved order: only what is ordered
            (o.sizes.length ? o.sizes : [""])
              .filter((size) => canEdit || get(o.id, size) > 0)
              .map((size, i) => {
                const item = size ? `${o.label} ${size}` : o.label;
                return (
                  <li class="list-row">
                    {/* Product photo in the first row of the item, below it space of the same width */}
                    {o.imageUrl ? (
                      i === 0 ? (
                        <button type="button" class="poll-thumb" aria-label={t`Photo: ${item}`} onClick={() => setPhoto(o)}>
                          <img src={o.imageUrl} alt="" loading="lazy" />
                        </button>
                      ) : (
                        <span class="poll-thumb poll-thumb-space" aria-hidden="true" />
                      )
                    ) : null}
                    <span class="main">
                      <span class="title">
                        {o.label}
                        {size ? ` · ${size}` : ""}
                      </span>
                      <span class="sub">{money(o.priceCents ?? 0)}</span>
                    </span>
                    <div class="poll-stepper" role="group" aria-label={t`${item}: quantity`}>
                      <button type="button" class="icon-btn" aria-label={t`Fewer`} disabled={!canEdit || get(o.id, size) <= 0} onClick={() => set(o.id, size, Math.max(0, get(o.id, size) - 1))}>
                        −
                      </button>
                      <span class="poll-stepper-value">{get(o.id, size)}</span>
                      <button type="button" class="icon-btn" aria-label={t`More`} disabled={!canEdit || get(o.id, size) >= 99} onClick={() => set(o.id, size, get(o.id, size) + 1)}>
                        +
                      </button>
                    </div>
                  </li>
                );
              }),
          )}
          <li class="list-row">
            <span class="main">
              <span class="title">
                <Trans>Total</Trans>
              </span>
            </span>
            <strong>{money(total)}</strong>
          </li>
        </ul>
      ) : null}

      {photo?.imageUrl ? (
        <Sheet open onClose={() => setPhoto(null)} title={photo.label}>
          <div class="stack">
            <img class="poll-photo" src={photo.imageUrl} alt={t`Photo: ${photoName}`} />
            <p class="small muted">
              {money(photo.priceCents ?? 0)}
              {photo.sizes.length ? ` · ${photo.sizes.join(", ")}` : ""}
            </p>
          </div>
        </Sheet>
      ) : null}

      {poll.kind === "order" && voted && !editing && poll.payment && unit.payment ? (
        <PaymentBox pollId={poll.id} payment={poll.payment} unit={unit} amounts={unit.payment} onSaved={onSaved} />
      ) : null}

      {poll.open ? (
        canEdit ? (
          <div class="row-gap">
            <Button variant="primary" disabled={!complete} onClick={save}>
              {poll.kind === "order" ? (total ? t`Order` : t`Order nothing`) : voted ? t`Save` : t`Vote`}
            </Button>
            {voted ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setValues(initial);
                  setEditing(false);
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
            ) : null}
          </div>
        ) : (
          <div class="row-gap">
            <Button icon="edit" onClick={() => setEditing(true)}>
              <Trans>Change</Trans>
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: t`Withdraw vote?`,
                    message: t`You can vote again afterwards while the poll runs.`,
                    confirmLabel: t`Withdraw`,
                    danger: true,
                  }))
                )
                  return;
                onSaved(await api.del<PollDetail>(`/polls/${poll.id}/ballot/${unit.unitId}`));
                toast(t`Vote withdrawn.`);
              }}
            >
              <Trans>Withdraw</Trans>
            </Button>
          </div>
        )
      ) : !voted ? (
        <p class="small muted">
          <Trans>The poll has ended.</Trans>
        </p>
      ) : null}
      {infoSheet}
    </section>
  );
}

function Names({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return <div class="small muted poll-names">{names.join(", ")}</div>;
}

function Results({ detail }: { detail: PollDetail }) {
  const { poll, options } = detail;
  const tallies = detail.tallies ?? [];
  if (poll.kind === "choice") {
    const max = Math.max(1, ...tallies.map((x) => x.units));
    const count = (o: PollOption) => tallies.find((x) => x.optionId === o.id)?.units ?? 0;
    const sorted = [...options].sort((a, b) => count(b) - count(a));
    return (
      <div class="stack-sm">
        {sorted.map((o) => (
          <div class="stack-sm">
            <div class="poll-row">
              <span>{o.label}</span>
              <strong>{count(o)}</strong>
            </div>
            <div class="poll-bar" aria-hidden="true">
              <span style={{ width: `${(count(o) / max) * 100}%` }} />
            </div>
            <Names names={tallies.find((x) => x.optionId === o.id)?.names} />
          </div>
        ))}
      </div>
    );
  }
  if (poll.kind === "schedule") {
    const at = (o: PollOption, v: number) => tallies.find((x) => x.optionId === o.id && x.value === v);
    const score = (o: PollOption) => (at(o, 2)?.units ?? 0) * 2 + (at(o, 1)?.units ?? 0);
    const best = Math.max(0, ...options.map(score));
    return (
      <ul class="list">
        {options.map((o) => {
          const yes = at(o, 2)?.units ?? 0;
          const maybe = at(o, 1)?.units ?? 0;
          const no = at(o, 0)?.units ?? 0;
          const yesNames = at(o, 2)?.names?.join(", ");
          const maybeNames = at(o, 1)?.names?.join(", ");
          const noNames = at(o, 0)?.names?.join(", ");
          return (
            <li class="list-row poll-slot">
              <span class="poll-slot-title">
                {best > 0 && score(o) === best ? <Icon name="star" size={16} /> : null}
                {slotLabel(o)}
              </span>
              <span class="small">
                <strong>
                  <Trans>{yes} yes</Trans>
                </strong>{" "}
                · <Trans>{maybe} maybe</Trans> · <Trans>{no} no</Trans>
              </span>
              {yesNames ? (
                <div class="small poll-names">
                  <Trans>Yes: {yesNames}</Trans>
                </div>
              ) : null}
              {maybeNames ? (
                <div class="small muted poll-names">
                  <Trans>Maybe: {maybeNames}</Trans>
                </div>
              ) : null}
              {noNames ? (
                <div class="small muted poll-names">
                  <Trans>No: {noNames}</Trans>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  // Orders: quantities per item with the amount, below them per size; the creator needs them to order from the supplier
  let sum = 0;
  const groups = options
    .map((o) => {
      const sizes = (o.sizes.length ? o.sizes : [""])
        .map((size) => ({ size, q: tallies.find((x) => x.optionId === o.id && x.size === size)?.quantity ?? 0 }))
        .filter((x) => x.q > 0);
      const q = sizes.reduce((n, x) => n + x.q, 0);
      sum += q * (o.priceCents ?? 0);
      return { option: o, sizes, q };
    })
    .filter((g) => g.q > 0);
  return (
    <ul class="list poll-quantities">
      {!groups.length ? (
        <li class="small muted">
          <Trans>Nothing ordered yet.</Trans>
        </li>
      ) : null}
      {groups.map((g) => {
        const item = g.option.label;
        const count = g.q;
        return (
          <li class="poll-qty-group">
            <div class="list-row">
              <span class="main">
                <span class="title">{item}</span>
                <span class="sub">{formatMoney(g.q * (g.option.priceCents ?? 0), poll.currency)}</span>
              </span>
              <strong>{plural(count, { one: "# piece", other: "# pieces" })}</strong>
            </div>
            {g.option.sizes.length ? (
              <ul class="poll-qty-sizes" aria-label={t`${item}: sizes`}>
                {g.sizes.map((x) => {
                  const size = x.size;
                  return (
                    <li class="poll-row">
                      <span>
                        <Trans>Size {size}</Trans>
                      </span>
                      <strong>{x.q}</strong>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
      <li class="list-row">
        <span class="main">
          <span class="title">
            <Trans>Total</Trans>
          </span>
        </span>
        <strong>{formatMoney(sum, poll.currency)}</strong>
      </li>
    </ul>
  );
}

function ManageSection({ detail, onChanged, onDeleted }: { detail: PollDetail; onChanged: (d: PollDetail) => void; onDeleted: () => void }) {
  const { poll, options } = detail;
  const money = (cents: number) => formatMoney(cents, poll.currency);
  const [endDate, setEndDate] = useState(poll.endsAt.slice(0, 10));
  const [endTime, setEndTime] = useState(poll.endsAt.slice(11, 16));
  const itemLabel = (optionId: number, size: string) => {
    const o = options.find((x) => x.id === optionId);
    return `${o ? optionLabel(o) : "?"}${size ? ` ${size}` : ""}`;
  };
  // "Order nothing" only fills the list; whoever has money reported or confirmed stays in it
  const realOrders = (detail.orders ?? []).filter((o) => o.items.length > 0 || o.paidCents > 0 || o.reportedCents > 0);
  const nothingOrdered = (detail.orders ?? []).filter((o) => !realOrders.includes(o));
  const pendingCount = detail.pending?.length ?? 0;
  const nothingCount = nothingOrdered.length;
  const paidSum = money((detail.orders ?? []).reduce((s, o) => s + Math.min(o.paidCents, o.totalCents), 0));
  const totalSum = money((detail.orders ?? []).reduce((s, o) => s + o.totalCents, 0));
  const created = fullDate(poll.createdAt.slice(0, 10));
  return (
    <section class="stack-sm" aria-label={t`Manage`}>
      <h2 class="section-title">{poll.teamId ? t`For you as coach` : t`For you as admin`}</h2>
      {detail.orders ? (
        <section class="card card-body stack-sm" aria-label={t`Orders`}>
          <strong>
            <Trans>Orders</Trans>
          </strong>
          {!realOrders.length ? (
            <p class="small muted">
              <Trans>No order yet.</Trans>
            </p>
          ) : null}
          <ul class="list">
            {realOrders.map((o) => {
              const no = o.orderNo ?? "";
              return (
                <li class="list-row" style={{ alignItems: "flex-start" }}>
                  <span class="main">
                    <span class="title">
                      {o.orderNo ? `${t`No.`} ${o.orderNo} · ` : ""}
                      {o.label}
                    </span>
                    <span class="sub">{o.items.length ? o.items.map((i) => `${i.quantity}× ${itemLabel(i.optionId, i.size)}`).join(", ") : t`nothing ordered`}</span>
                  </span>
                  <span class="stack-sm" style={{ alignItems: "flex-end" }}>
                    <strong>{money(o.totalCents)}</strong>
                    <OrderPaymentStatus order={o} currency={poll.currency} />
                    {detail.canEdit && (o.totalCents > 0 || o.paidCents > 0) ? (
                      <label class="small poll-paid">
                        <input
                          type="checkbox"
                          checked={o.paid}
                          aria-label={t`No. ${no} paid`}
                          onChange={async (e) => {
                            const paid = (e.target as HTMLInputElement).checked;
                            onChanged(await api.put<PollDetail>(`/polls/${poll.id}/ballot/${o.unitId}/paid`, { paid }));
                          }}
                        />{" "}
                        <Trans>paid</Trans>
                      </label>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {nothingOrdered.length ? (
            <details class="small">
              <summary>{t`Nothing ordered (${nothingCount})`}</summary>
              <ul class="poll-pending">
                {nothingOrdered.map((o) => (
                  <li>{o.label}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {realOrders.length ? (
            <p class="small muted">
              <Trans>
                Paid: {paidSum} of {totalSum}
              </Trans>
            </p>
          ) : null}
          {/* Contains names: only managers get the orders, so only they see the button */}
          {realOrders.some((o) => o.items.length) ? (
            <div>
              <Button icon="download" size="sm" onClick={() => downloadOrders(detail)}>
                <Trans>Download as Excel</Trans>
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {detail.pending ? (
        <section class="card card-body stack-sm" aria-label={poll.kind === "order" ? t`Not ordered yet` : t`Not voted yet`}>
          <strong>{poll.kind === "order" ? t`Not ordered yet (${pendingCount})` : t`Not voted yet (${pendingCount})`}</strong>
          {detail.pending.length ? (
            <ul class="poll-pending small">
              {detail.pending.map((n) => (
                <li>{n}</li>
              ))}
            </ul>
          ) : (
            <p class="small">{poll.kind === "order" ? t`Everyone has ordered.` : t`Everyone has voted.`}</p>
          )}
        </section>
      ) : poll.anonymous ? (
        <p class="small muted">
          <Trans>Anonymous: nobody sees who voted what, not even you.</Trans>
        </p>
      ) : null}
      {detail.canEdit ? (
        <a class="btn" href={`/umfragen/${poll.id}/bearbeiten`}>
          <Icon name="edit" size={18} />
          <Trans>Edit poll</Trans>
        </a>
      ) : null}
      <section class="card card-body stack-sm" aria-label={t`End of the poll`}>
        <strong>{poll.open ? t`Change the end` : t`Reopen`}</strong>
        <div class="grid-2">
          <input class="input" type="date" aria-label={t`Ends on`} value={endDate} min={todayLocal()} onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />
          <input class="input" type="time" aria-label={t`Ends at`} value={endTime} onInput={(e) => setEndTime((e.target as HTMLInputElement).value)} />
        </div>
        <div class="row-gap">
          <Button
            onClick={async () => {
              onChanged(await api.patch<PollDetail>(`/polls/${poll.id}`, { endsAt: `${endDate}T${endTime}` }));
              toast(t`End saved.`);
            }}
          >
            <Trans>Save</Trans>
          </Button>
          {poll.open ? (
            <Button
              variant="ghost"
              onClick={async () => {
                if (!(await confirmDialog({ title: t`End the poll now?`, message: t`Afterwards nobody can vote any more.`, confirmLabel: t`End` }))) return;
                onChanged(await api.post<PollDetail>(`/polls/${poll.id}/close`));
                toast(t`Poll ended.`);
              }}
            >
              <Trans>End now</Trans>
            </Button>
          ) : null}
        </div>
      </section>
      <Button
        variant="danger"
        icon="trash"
        onClick={async () => {
          if (!(await confirmDialog({ title: t`Delete poll?`, message: t`All votes are lost.`, confirmLabel: t`Delete`, danger: true }))) return;
          await api.del(`/polls/${poll.id}`);
          pollsChanged();
          toast(t`Poll deleted.`);
          onDeleted();
        }}
      >
        <Trans>Delete poll</Trans>
      </Button>
      <p class="small muted">
        <Trans>Created on {created}.</Trans>
      </p>
    </section>
  );
}

// Payment -----------------------------------------------------------------------------------------------

/** When creating an order: which payment details apply (Administration → Polls). */
function PaymentHint() {
  const me = useMe();
  const { data } = useQuery<PollPayment>("/polls/payment");
  if (!data) return null;
  const paypal = data.paypal;
  const holder = data.holder;
  const ways = [paypal ? t`PayPal (paypal.me/${paypal})` : null, data.iban && holder ? t`bank transfer to ${holder}` : null].filter((x): x is string => !!x);
  const list = ways.join(" / ");
  return (
    <p class="small muted">
      {ways.length ? (
        t`Payment by ${list}, as set for the club. The reference is the title with the order number.`
      ) : me.isAdmin ? (
        <Trans>
          No payment details yet. Add them under <a href="/verwaltung/umfragen">Administration → Polls</a>.
        </Trans>
      ) : (
        <Trans>Payment details (PayPal, bank account) are set by an admin for the club. There are none yet.</Trans>
      )}
    </p>
  );
}

/** IBAN in groups of four */
function ibanGroups(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

/** Order list: reported, partly paid, paid too much. */
function OrderPaymentStatus({ order, currency }: { order: PollOrder; currency: string }) {
  const s = paymentState({ totalCents: order.totalCents, paidCents: order.paidCents, reportedCents: order.reportedCents });
  if (s.totalCents <= 0 && s.paidCents <= 0) return null;
  const money = (cents: number) => formatMoney(cents, currency);
  const reported = money(s.reportedCents);
  const paid = money(s.paidCents);
  const rest = money(s.totalCents - s.paidCents);
  const over = money(s.overCents);
  const parts: string[] = [];
  if (s.awaiting) parts.push(t`${reported} reported as paid`);
  if (s.paidCents > 0 && !s.settled) parts.push(t`${paid} paid, ${rest} open`);
  if (s.overCents > 0) parts.push(t`${over} paid too much`);
  return parts.length ? <span class={`small ${s.awaiting ? "poll-reported" : "muted"}`}>{parts.join(" · ")}</span> : null;
}

function PaymentBox({ pollId, payment, unit, amounts, onSaved }: { pollId: number; payment: PollPayment; unit: PollUnit; amounts: PaymentAmounts; onSaved: (d: PollDetail) => void }) {
  const state = paymentState(amounts);
  if (state.totalCents <= 0 && state.paidCents <= 0) return null;
  const money = (cents: number) => formatMoney(cents, payment.currency);
  const report = async (reported: boolean) => {
    onSaved(await api.put<PollDetail>(`/polls/${pollId}/ballot/${unit.unitId}/reported`, { reported }));
    toast(reported ? t`Reported as paid.` : t`Report taken back.`);
  };
  const confirmHint = (
    <p class="small muted">
      <Trans>As soon as we see the payment we mark the order as paid. This can take 1 to 2 days.</Trans>
    </p>
  );
  if (state.dueCents <= 0) {
    const reported = money(state.reportedCents);
    const over = money(state.overCents);
    return (
      <div class="stack-sm poll-pay" role="group" aria-label={t`Pay`}>
        {state.awaiting ? (
          <>
            <p class="small poll-paid-note">
              <Icon name="clock" size={16} /> <Trans>Reported as paid ({reported}), waiting for confirmation.</Trans>
            </p>
            {confirmHint}
            <button type="button" class="link-btn small" onClick={() => void report(false)}>
              <Trans>Not paid yet after all</Trans>
            </button>
          </>
        ) : (
          <p class="small poll-paid-note">
            <Icon name="check" size={16} /> <Trans>Paid, thank you!</Trans>
            {state.overCents > 0 ? ` ${t`Paid too much: ${over}. Whoever created the order will sort it out.`}` : ""}
          </p>
        )}
      </div>
    );
  }
  const cents = state.dueCents;
  const partly = state.paidCents > 0 || state.reportedCents > 0;
  const reference = unit.reference ?? "";
  const note = unit.paypalNote ?? reference;
  const ordered = money(state.totalCents);
  const paid = money(state.paidCents);
  const reported = money(state.reportedCents);
  return (
    <div class="stack-sm poll-pay" role="group" aria-label={t`Pay`}>
      <div class="poll-row">
        <strong>{partly ? t`Still open` : t`Payment open`}</strong>
        <strong>{money(cents)}</strong>
      </div>
      {partly ? (
        <p class="small muted" style={{ margin: 0 }}>
          {t`Ordered ${ordered}`}
          {state.paidCents > 0 ? `, ${t`paid ${paid}`}` : ""}
          {state.reportedCents > state.paidCents ? `, ${t`reported as paid ${reported}`}` : ""}.
        </p>
      ) : null}
      {payment.paypal ? (
        <>
          <a
            class="btn btn-primary"
            href={`https://paypal.me/${encodeURIComponent(payment.paypal)}/${(cents / 100).toFixed(2)}${payment.currency}`}
            target="_blank"
            rel="noopener noreferrer"
            // PayPal cannot prefill a message: copied to the clipboard when tapped
            onClick={() => void copyText(note, t`Note copied, paste it in PayPal.`)}
          >
            <Trans>Pay with PayPal</Trans>
          </a>
          <div class="poll-note small">
            <span>
              <Trans>
                Note (copied when tapped, paste it in PayPal): <strong>{note}</strong>
              </Trans>
            </span>
            <button type="button" class="icon-btn" aria-label={t`Copy note`} onClick={() => void copyText(note, t`Note copied.`)}>
              <Icon name="copy" size={16} />
            </button>
          </div>
        </>
      ) : null}
      {payment.iban && payment.holder ? (
        <div class="stack-sm">
          <dl class="poll-bank">
            <dt>
              <Trans>Recipient</Trans>
            </dt>
            <dd>{payment.holder}</dd>
            <dt>IBAN</dt>
            <dd>
              <span class="poll-mono">{ibanGroups(payment.iban)}</span>
              <button type="button" class="icon-btn" aria-label={t`Copy IBAN`} onClick={() => void copyText(payment.iban!, t`IBAN copied.`)}>
                <Icon name="copy" size={16} />
              </button>
            </dd>
            <dt>
              <Trans>Amount</Trans>
            </dt>
            <dd>{money(cents)}</dd>
            <dt>
              <Trans>Reference</Trans>
            </dt>
            <dd>
              <span>{reference}</span>
              <button type="button" class="icon-btn" aria-label={t`Copy reference`} onClick={() => void copyText(reference, t`Reference copied.`)}>
                <Icon name="copy" size={16} />
              </button>
            </dd>
          </dl>
          {payment.currency === "EUR" ? (
            <details class="howto-fold">
              <summary>
                <Trans>QR code for the banking app</Trans>
              </summary>
              <div
                class="qr"
                role="img"
                aria-label={t`QR code with recipient, IBAN, amount and reference`}
                dangerouslySetInnerHTML={{ __html: renderSVG(epcPayload(payment.holder, payment.iban, cents, reference), { border: 1, ecc: "M" }) }}
              />
              <p class="small muted">
                <Trans>In the banking app choose “Scan” or “Photo transfer”. On the phone itself: take a screenshot and open it there.</Trans>
              </p>
            </details>
          ) : null}
        </div>
      ) : null}
      <Button variant="secondary" icon="check" onClick={() => report(true)}>
        <Trans>I have paid</Trans>
      </Button>
      {confirmHint}
    </div>
  );
}

/** The orders as an Excel file, built here from what the manager already sees; nothing is sent anywhere. */
function downloadOrders(detail: PollDetail): void {
  const bytes = xlsx(orderSheets(detail), { moneyFormat: moneyFormat(detail.poll.currency, intlTag(currentLocale())) });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url;
  // Not empty: the router intercepts links without a download value
  a.download = orderFilename(detail.poll.title, todayLocal());
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
