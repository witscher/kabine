// Carpools for away games: card in the event detail view.
// Rules in the worker (../worker/domain.ts), decisions in docs/design.md, Carpools.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { EventDetail } from "../../../shared/types";
import type { CarpoolInfo, CarpoolOffer, CarpoolPersonRef, CarpoolRequest } from "../types";
import { api } from "../../../src/api";
import { Icon } from "../../../src/icons";
import { useMe } from "../../../src/session";
import { invalidate } from "../../../src/store";
import { Button, confirmDialog, Sheet, toast } from "../../../src/ui";

const MAX_SEATS = 8;

const seatsText = (n: number) => plural(n, { one: "# seat", other: "# seats" });
const riderText = (r: { name: string; companions: number }) => (r.companions ? `${r.name} + ${r.companions}` : r.name);

type OfferTarget = { personId: number | null; offer: CarpoolOffer | null };
type RideTarget = { player: CarpoolPersonRef | null; self: boolean; request: CarpoolRequest | null; asCoach: boolean };

export function CarpoolCard({ event, carpool, onChanged }: { event: EventDetail; carpool: CarpoolInfo; onChanged: () => void }) {
  const me = useMe();
  const [offerFor, setOfferFor] = useState<OfferTarget | null>(null);
  const [rideFor, setRideFor] = useState<RideTarget | null>(null);
  const refresh = () => {
    invalidate("/events");
    onChanged();
  };
  const base = `/events/${event.id}/carpool`;
  const own = carpool.offers.find((o) => o.mine) ?? null;
  const free = carpool.offers.reduce((n, o) => n + o.free, 0);
  const waitingSeats = carpool.waiting.reduce((n, r) => n + r.seats, 0);
  const searchable = carpool.mine.filter((m) => !m.request);
  const driverName = (offerId: number | null) => carpool.offers.find((o) => o.id === offerId)?.name ?? "";

  const cancelBooking = async (r: CarpoolRequest) => {
    const name = r.name;
    const driver = driverName(r.offerId);
    if (!(await confirmDialog({ title: t`Not riding after all?`, message: t`${name} is no longer riding with ${driver}. The driver will be notified.`, confirmLabel: t`Cancel ride` }))) return;
    await api.del(`${base}/requests/${r.playerId}/booking`);
    toast(t`Ride cancelled.`);
    refresh();
  };
  const deleteRequest = async (r: CarpoolRequest) => {
    await api.del(`${base}/requests/${r.playerId}`);
    toast(t`Ride request deleted.`);
    refresh();
  };

  const drivers = carpool.offers.length;
  const freeSeats = seatsText(free);
  const waiting = carpool.waiting.length;
  const seatsNeeded = seatsText(waitingSeats);
  const ownTaken = own ? own.seats - own.free : 0;
  const ownSeats = own ? seatsText(own.seats) : "";

  return (
    <section class="card card-body" aria-label={t`Carpools`}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Carpools</Trans>
        </h2>
        <Icon name="car" size={22} />
      </div>
      <p class="small muted">
        {drivers ? plural(drivers, { one: `# driver · ${freeSeats} free`, other: `# drivers · ${freeSeats} free` }) : t`Nobody is offering seats yet`}
        {waiting ? ` · ${plural(waiting, { one: `# is looking (${seatsNeeded})`, other: `# are looking (${seatsNeeded})` })}` : ""}
      </p>

      {own ? (
        <div class="row-gap" style={{ justifyContent: "space-between" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              <Trans>You are driving</Trans>
            </strong>
            <div class="small muted">
              {t`${ownTaken} of ${ownSeats} taken`}
              {own.riders.length ? `: ${own.riders.map(riderText).join(", ")}` : ""}
            </div>
          </div>
          {own.canEdit ? (
            <Button size="sm" onClick={() => setOfferFor({ personId: own.personId, offer: own })}>
              <Trans>Change</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {carpool.mine
        .filter((m) => m.request)
        .map(({ player, request: r }) => {
          const driver = driverName(r!.offerId);
          const seats = seatsText(r!.seats);
          const name = player.name;
          return (
          <div class="row-gap" style={{ justifyContent: "space-between" }} key={player.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{player.self ? t`You` : player.name}</strong>
              <div class="small muted">
                {r!.offerId != null
                  ? player.self
                    ? t`are riding with ${driver} (${seats})`
                    : t`is riding with ${driver} (${seats})`
                  : player.self
                    ? t`are looking for a ride (${seats})`
                    : t`is looking for a ride (${seats})`}
              </div>
            </div>
            {r!.canEdit ? (
              r!.offerId != null ? (
                <Button size="sm" onClick={() => cancelBooking(r!)}>
                  <Trans>Not after all</Trans>
                </Button>
              ) : (
                <div class="row-gap" style={{ gap: "6px" }}>
                  <Button size="sm" variant="primary" onClick={() => setRideFor({ player, self: player.self, request: r, asCoach: false })}>
                    <Trans>Ride along</Trans>
                  </Button>
                  <button type="button" class="icon-btn icon-btn-sm" aria-label={t`Delete ride request for ${name}`} onClick={() => deleteRequest(r!)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )
            ) : null}
          </div>
          );
        })}

      {carpool.open && (carpool.canOffer || searchable.length) ? (
        <div class={carpool.canOffer && searchable.length ? "grid-2" : "stack-sm"}>
          {carpool.canOffer ? (
            <Button variant="primary" onClick={() => setOfferFor({ personId: me.person.id, offer: null })}>
              <Trans>I'm driving</Trans>
            </Button>
          ) : null}
          {searchable.length ? (
            <Button
              onClick={() => {
                const only = searchable.length === 1 ? searchable[0]!.player : null;
                setRideFor({ player: only, self: only?.self ?? false, request: null, asCoach: false });
              }}
            >
              <Trans>I need a ride</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {carpool.offers.filter((o) => !o.mine).length ? (
        <div class="stack-sm">
          <div class="small muted" style={{ fontWeight: 700 }}>
            <Trans>DRIVERS</Trans>
          </div>
          {carpool.offers
            .filter((o) => !o.mine)
            .map((o) => {
              const seats = seatsText(o.free);
              return (
              <div class="row-gap" style={{ justifyContent: "space-between" }} key={o.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{o.name}</strong>
                  <div class="small muted">
                    {o.free ? t`${seats} free` : t`full`}
                    {o.riders.length ? ` · ${o.riders.map(riderText).join(", ")}` : ""}
                  </div>
                </div>
                {o.canEdit ? (
                  <Button size="sm" onClick={() => setOfferFor({ personId: o.personId, offer: o })}>
                    <Trans>Change</Trans>
                  </Button>
                ) : null}
              </div>
              );
            })}
        </div>
      ) : null}

      {carpool.waiting.filter((r) => !r.mine).length ? (
        <div class="stack-sm">
          <div class="small muted" style={{ fontWeight: 700 }}>
            <Trans>STILL LOOKING</Trans>
          </div>
          {carpool.waiting
            .filter((r) => !r.mine)
            .map((r) => (
              <div class="row-gap" style={{ justifyContent: "space-between" }} key={r.id}>
                <span>
                  <strong>{r.name}</strong> <span class="small muted">{seatsText(r.seats)}</span>
                </span>
                {r.canEdit ? (
                  <Button size="sm" onClick={() => setRideFor({ player: { id: r.playerId, name: r.name }, self: false, request: r, asCoach: true })}>
                    <Trans>Assign</Trans>
                  </Button>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      {carpool.coach ? (
        <div class="stack-sm">
          <div class="small muted" style={{ fontWeight: 700 }}>
            <Trans>FOR COACHES</Trans>
          </div>
          <div class="grid-2">
            <Button size="sm" onClick={() => setOfferFor({ personId: null, offer: null })}>
              <Trans>Add driver</Trans>
            </Button>
            <Button size="sm" onClick={() => setRideFor({ player: null, self: false, request: null, asCoach: true })}>
              <Trans>Add passenger</Trans>
            </Button>
          </div>
        </div>
      ) : null}

      {!carpool.open ? (
        <p class="small muted">
          <Trans>The game has been cancelled or has already started.</Trans>
        </p>
      ) : null}

      {offerFor ? <OfferSheet event={event} carpool={carpool} target={offerFor} onClose={() => setOfferFor(null)} onDone={refresh} /> : null}
      {rideFor ? <RideSheet event={event} carpool={carpool} target={rideFor} onClose={() => setRideFor(null)} onDone={refresh} /> : null}
    </section>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div class="duty-stepper">
      <span>{label}</span>
      <button type="button" class="icon-btn icon-btn-sm" aria-label={t`One seat fewer`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" class="icon-btn icon-btn-sm" aria-label={t`One seat more`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

function CheckRow({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled?: boolean; onToggle?: () => void }) {
  return (
    <button type="button" class={`squad-row ${checked ? "on" : ""}`} role="checkbox" aria-checked={checked ? "true" : "false"} disabled={disabled} onClick={onToggle}>
      <span class={`check ${checked ? "on" : ""}`}>{checked ? <Icon name="check" size={16} stroke={3} /> : null}</span>
      <span style={{ flex: 1, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

/** Create or change an offer; coaches choose the driver. */
function OfferSheet({ event, carpool, target, onClose, onDone }: { event: EventDetail; carpool: CarpoolInfo; target: OfferTarget; onClose: () => void; onDone: () => void }) {
  const [personId, setPersonId] = useState<number | null>(target.personId);
  const [seats, setSeats] = useState(target.offer?.seats ?? 1);
  const [remove, setRemove] = useState<number[]>([]);
  const offer = target.offer;
  const base = `/events/${event.id}/carpool/offers`;
  const taken = offer ? offer.riders.filter((r) => !remove.includes(r.id)).reduce((n, r) => n + r.seats, 0) : 0;
  const tooFew = seats < taken;
  // Coaches without a preselection choose the driver; whoever is already driving is missing from the choice
  const candidates = carpool.coach?.drivers.filter((d) => !carpool.offers.some((o) => o.personId === d.id)) ?? [];
  const chosen = target.personId == null;

  const save = async () => {
    if (personId == null) return;
    await api.put(`${base}/${personId}`, { seats, removeRequestIds: remove.length ? remove : undefined });
    toast(offer ? t`Offer changed.` : t`Thanks! Anyone who wants to ride along can now book.`);
    onClose();
    onDone();
  };

  const driver = offer?.name ?? "";
  return (
    <Sheet open onClose={onClose} title={offer ? (offer.mine ? t`Your offer` : t`Offer from ${driver}`) : t`I'm driving`}>
      {chosen && !offer ? (
        <>
          <p class="muted">
            <Trans>Who is driving?</Trans>
          </p>
          <div class="chips">
            {candidates.map((d) => (
              <button type="button" class={`chip ${personId === d.id ? "selected" : ""}`} onClick={() => setPersonId(d.id)} key={d.id}>
                {d.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p class="muted">
        <Trans>How many seats are free? Not counting you and your own passengers.</Trans>
      </p>
      <Stepper label={t`Free seats`} value={seats} min={1} max={MAX_SEATS} onChange={setSeats} />
      {offer?.riders.length ? (
        <>
          <p class="small muted">
            <Trans>Riding along. Deselect anyone you can no longer take; the family will be notified and will look again.</Trans>
          </p>
          <ul class="list">
            {offer.riders.map((r) => (
              <li key={r.id}>
                <CheckRow
                  label={`${riderText(r)} (${seatsText(r.seats)})`}
                  checked={!remove.includes(r.id)}
                  onToggle={() => setRemove(remove.includes(r.id) ? remove.filter((x) => x !== r.id) : [...remove, r.id])}
                />
              </li>
            ))}
          </ul>
          {tooFew ? (
            <p class="small" style={{ color: "var(--red)" }}>
              <Trans>{taken} people are riding along. Please enter more seats or deselect passengers.</Trans>
            </p>
          ) : null}
        </>
      ) : null}
      <Button variant="primary" size="lg" block disabled={tooFew || personId == null} onClick={save}>
        {offer ? t`Save` : t`Offer seats`}
      </Button>
      {offer ? (
        <Button
          variant="ghost"
          icon="trash"
          onClick={async () => {
            const msg = offer.riders.length ? t`All passengers will be notified and will look again.` : t`The offer will be deleted.`;
            if (!(await confirmDialog({ title: t`Withdraw offer?`, message: msg, confirmLabel: t`Withdraw`, danger: true }))) return;
            await api.del(`${base}/${offer.personId}`);
            toast(t`Offer withdrawn.`);
            onClose();
            onDone();
          }}
        >
          <Trans>Withdraw offer</Trans>
        </Button>
      ) : null}
    </Sheet>
  );
}

/** Look for and book a ride; coaches choose the player. */
function RideSheet({ event, carpool, target, onClose, onDone }: { event: EventDetail; carpool: CarpoolInfo; target: RideTarget; onClose: () => void; onDone: () => void }) {
  const me = useMe();
  const options = target.asCoach
    ? (carpool.coach?.riders ?? []).filter((r) => !carpool.offers.some((o) => o.riders.some((x) => x.playerId === r.id)) && !carpool.waiting.some((w) => w.playerId === r.id))
    : carpool.mine.filter((m) => !m.request).map((m) => m.player);
  const [player, setPlayer] = useState<CarpoolPersonRef | null>(target.player);
  const self = target.asCoach ? false : (carpool.mine.find((m) => m.player.id === player?.id)?.player.self ?? target.self);
  const [extra, setExtra] = useState<boolean[]>(() => [0, 1].map((i) => (target.request?.companions ?? 0) > i));
  const companions = extra.filter(Boolean).length;
  const need = 1 + companions;
  const base = `/events/${event.id}/carpool/requests`;
  const offers = carpool.offers.filter((o) => o.free >= need);
  // Companions: the passenger's parents by name (yourself first, with "you"); coaches travel with companions
  const rider = [...carpool.mine.map((m) => m.player), ...(carpool.coach?.riders ?? [])].find((r) => r.id === player?.id);
  const isCoach = !!rider?.coach;
  const guardians = [...(rider?.guardians ?? [])].sort((a, b) => Number(b.id === me.person.id) - Number(a.id === me.person.id));
  const fallback = isCoach ? [t`One companion`, t`Second companion`] : guardians.length ? [t`Another companion`, t`Another companion`] : [t`One parent`, t`Second parent`];
  const labels = [0, 1].map((i) => {
    const g = guardians[i];
    const name = g?.name ?? "";
    return g ? (g.id === me.person.id ? t`${name} (you)` : g.name) : fallback[i]!;
  });
  const needed = seatsText(need);

  const ensureRequest = async () => {
    if (!player) return false;
    if (!target.request || target.request.companions !== companions) await api.put(`${base}/${player.id}`, { companions });
    return true;
  };

  return (
    <Sheet open onClose={onClose} title={target.asCoach ? t`Add passenger` : t`Getting a ride`}>
      {!target.player ? (
        <>
          <p class="muted">{target.asCoach ? t`Who needs a ride?` : t`For whom?`}</p>
          <div class="chips">
            {options.map((o) => (
              <button type="button" class={`chip ${player?.id === o.id ? "selected" : ""}`} onClick={() => setPlayer(o)} key={o.id}>
                {o.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {player ? (
        <>
          <p class="muted">
            <Trans>Who is riding along?</Trans>
          </p>
          <ul class="list">
            <li>
              <CheckRow label={self ? t`Me` : player.name} checked disabled />
            </li>
            {labels.map((label, i) => (
              <li key={i}>
                <CheckRow label={label} checked={extra[i]!} onToggle={() => setExtra(extra.map((v, j) => (j === i ? !v : v)))} />
              </li>
            ))}
          </ul>
          <p class="small muted">
            <Trans>Needed: {needed}</Trans>
          </p>
          {offers.length ? (
            <div class="stack-sm">
              {offers.map((o) => {
                const seats = seatsText(o.free);
                const driver = o.name;
                const driverFirstName = o.name.split(" ")[0] ?? "";
                const name = player.name;
                return (
                <div class="row-gap" style={{ justifyContent: "space-between" }} key={o.id}>
                  <span>
                    <strong>{o.name}</strong> <span class="small muted">{t`${seats} free`}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (!(await ensureRequest())) return;
                      await api.put(`${base}/${player.id}/booking`, { offerId: o.id });
                      toast(
                        self
                          ? t`You are riding with ${driver}. ${driverFirstName} will be notified.`
                          : t`${name} is riding with ${driver}. ${driverFirstName} will be notified.`,
                      );
                      onClose();
                      onDone();
                    }}
                  >
                    <Trans>Ride along</Trans>
                  </Button>
                </div>
                );
              })}
            </div>
          ) : (
            <p class="small muted">
              <Trans>Nobody has enough free seats right now.</Trans>
            </p>
          )}
          {!target.request || target.request.companions !== companions ? (
            <Button
              block
              onClick={async () => {
                if (!(await ensureRequest())) return;
                toast(t`Saved. As soon as someone offers seats, you will get a notification.`);
                onClose();
                onDone();
              }}
            >
              {target.request ? t`Save change` : t`Wait until someone offers seats`}
            </Button>
          ) : null}
          {target.asCoach && target.request ? (
            <Button
              variant="ghost"
              icon="trash"
              onClick={async () => {
                await api.del(`${base}/${player.id}`);
                toast(t`Ride request deleted.`);
                onClose();
                onDone();
              }}
            >
              <Trans>Delete ride request</Trans>
            </Button>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
