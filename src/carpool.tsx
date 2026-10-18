// Fahrgemeinschaften bei Auswärtsspielen: Karte in der Termin-Detailansicht.
// Regeln im Worker (worker/domain/carpool.ts), Festlegungen in docs/entscheidungen.md.
import { useState } from "preact/hooks";
import type { CarpoolInfo, CarpoolOffer, CarpoolPersonRef, CarpoolRequest, EventDetail } from "../shared/types";
import { api } from "./api";
import { Icon } from "./icons";
import { useMe } from "./session";
import { invalidate } from "./store";
import { Button, confirmDialog, Sheet, toast } from "./ui";

const MAX_SEATS = 8;

const seatsText = (n: number) => (n === 1 ? "1 Platz" : `${n} Plätze`);
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
    if (!(await confirmDialog({ title: "Doch nicht mitfahren?", message: `${r.name} fährt nicht mehr bei ${driverName(r.offerId)} mit. Der Fahrer wird benachrichtigt.`, confirmLabel: "Absagen" }))) return;
    await api.del(`${base}/requests/${r.playerId}/booking`);
    toast("Mitfahrt abgesagt.");
    refresh();
  };
  const deleteRequest = async (r: CarpoolRequest) => {
    await api.del(`${base}/requests/${r.playerId}`);
    toast("Suche gelöscht.");
    refresh();
  };

  return (
    <section class="card card-body" aria-label="Fahrgemeinschaften">
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <h2 class="section-title" style={{ margin: 0 }}>
          Fahrgemeinschaften
        </h2>
        <Icon name="car" size={22} />
      </div>
      <p class="small muted">
        {carpool.offers.length ? `${carpool.offers.length} Fahrer · ${seatsText(free)} frei` : "Noch niemand bietet Plätze an"}
        {carpool.waiting.length ? ` · ${carpool.waiting.length} ${carpool.waiting.length === 1 ? "sucht" : "suchen"} (${seatsText(waitingSeats)})` : ""}
      </p>

      {own ? (
        <div class="row-gap" style={{ justifyContent: "space-between" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Du fährst</strong>
            <div class="small muted">
              {own.seats - own.free} von {seatsText(own.seats)} belegt
              {own.riders.length ? `: ${own.riders.map(riderText).join(", ")}` : ""}
            </div>
          </div>
          {own.canEdit ? (
            <Button size="sm" onClick={() => setOfferFor({ personId: own.personId, offer: own })}>
              Ändern
            </Button>
          ) : null}
        </div>
      ) : null}

      {carpool.mine
        .filter((m) => m.request)
        .map(({ player, request: r }) => (
          <div class="row-gap" style={{ justifyContent: "space-between" }} key={player.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{player.self ? "Du" : player.name}</strong>
              <div class="small muted">
                {r!.offerId != null
                  ? `${player.self ? "fährst" : "fährt"} bei ${driverName(r!.offerId)} mit (${seatsText(r!.seats)})`
                  : `${player.self ? "suchst" : "sucht"} eine Mitfahrgelegenheit (${seatsText(r!.seats)})`}
              </div>
            </div>
            {r!.canEdit ? (
              r!.offerId != null ? (
                <Button size="sm" onClick={() => cancelBooking(r!)}>
                  Doch nicht
                </Button>
              ) : (
                <div class="row-gap" style={{ gap: "6px" }}>
                  <Button size="sm" variant="primary" onClick={() => setRideFor({ player, self: player.self, request: r, asCoach: false })}>
                    Mitfahren
                  </Button>
                  <button type="button" class="icon-btn icon-btn-sm" aria-label={`Suche für ${player.name} löschen`} onClick={() => deleteRequest(r!)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )
            ) : null}
          </div>
        ))}

      {carpool.open && (carpool.canOffer || searchable.length) ? (
        <div class={carpool.canOffer && searchable.length ? "grid-2" : "stack-sm"}>
          {carpool.canOffer ? (
            <Button variant="primary" onClick={() => setOfferFor({ personId: me.person.id, offer: null })}>
              Ich fahre
            </Button>
          ) : null}
          {searchable.length ? (
            <Button
              onClick={() => {
                const only = searchable.length === 1 ? searchable[0]!.player : null;
                setRideFor({ player: only, self: only?.self ?? false, request: null, asCoach: false });
              }}
            >
              Ich brauche eine Mitfahrgelegenheit
            </Button>
          ) : null}
        </div>
      ) : null}

      {carpool.offers.filter((o) => !o.mine).length ? (
        <div class="stack-sm">
          <div class="small muted" style={{ fontWeight: 700 }}>
            FAHRER
          </div>
          {carpool.offers
            .filter((o) => !o.mine)
            .map((o) => (
              <div class="row-gap" style={{ justifyContent: "space-between" }} key={o.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{o.name}</strong>
                  <div class="small muted">
                    {o.free ? `${seatsText(o.free)} frei` : "voll"}
                    {o.riders.length ? ` · ${o.riders.map(riderText).join(", ")}` : ""}
                  </div>
                </div>
                {o.canEdit ? (
                  <Button size="sm" onClick={() => setOfferFor({ personId: o.personId, offer: o })}>
                    Ändern
                  </Button>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      {carpool.waiting.filter((r) => !r.mine).length ? (
        <div class="stack-sm">
          <div class="small muted" style={{ fontWeight: 700 }}>
            SUCHEN NOCH
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
                    Eintragen
                  </Button>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      {carpool.coach ? (
        <div class="stack-sm">
          <div class="small muted" style={{ fontWeight: 700 }}>
            FÜR TRAINER
          </div>
          <div class="grid-2">
            <Button size="sm" onClick={() => setOfferFor({ personId: null, offer: null })}>
              Fahrer eintragen
            </Button>
            <Button size="sm" onClick={() => setRideFor({ player: null, self: false, request: null, asCoach: true })}>
              Mitfahrer eintragen
            </Button>
          </div>
        </div>
      ) : null}

      {!carpool.open ? <p class="small muted">Das Spiel ist abgesagt oder hat schon begonnen.</p> : null}

      {offerFor ? <OfferSheet event={event} carpool={carpool} target={offerFor} onClose={() => setOfferFor(null)} onDone={refresh} /> : null}
      {rideFor ? <RideSheet event={event} carpool={carpool} target={rideFor} onClose={() => setRideFor(null)} onDone={refresh} /> : null}
    </section>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div class="duty-stepper">
      <span>{label}</span>
      <button type="button" class="icon-btn icon-btn-sm" aria-label="Ein Platz weniger" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" class="icon-btn icon-btn-sm" aria-label="Ein Platz mehr" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
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

/** Angebot anlegen oder ändern; Trainer wählen den Fahrer aus. */
function OfferSheet({ event, carpool, target, onClose, onDone }: { event: EventDetail; carpool: CarpoolInfo; target: OfferTarget; onClose: () => void; onDone: () => void }) {
  const [personId, setPersonId] = useState<number | null>(target.personId);
  const [seats, setSeats] = useState(target.offer?.seats ?? 1);
  const [remove, setRemove] = useState<number[]>([]);
  const offer = target.offer;
  const base = `/events/${event.id}/carpool/offers`;
  const taken = offer ? offer.riders.filter((r) => !remove.includes(r.id)).reduce((n, r) => n + r.seats, 0) : 0;
  const tooFew = seats < taken;
  // Trainer ohne Vorauswahl wählen den Fahrer; wer schon fährt, fehlt in der Auswahl
  const candidates = carpool.coach?.drivers.filter((d) => !carpool.offers.some((o) => o.personId === d.id)) ?? [];
  const chosen = target.personId == null;

  const save = async () => {
    if (personId == null) return;
    await api.put(`${base}/${personId}`, { seats, removeRequestIds: remove.length ? remove : undefined });
    toast(offer ? "Angebot geändert." : "Danke! Wer mitfahren möchte, kann jetzt buchen.");
    onClose();
    onDone();
  };

  return (
    <Sheet open onClose={onClose} title={offer ? (offer.mine ? "Dein Angebot" : `Angebot von ${offer.name}`) : "Ich fahre"}>
      {chosen && !offer ? (
        <>
          <p class="muted">Wer fährt?</p>
          <div class="chips">
            {candidates.map((d) => (
              <button type="button" class={`chip ${personId === d.id ? "selected" : ""}`} onClick={() => setPersonId(d.id)} key={d.id}>
                {d.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p class="muted">Wie viele Plätze sind frei? Ohne dich und deine eigenen Mitfahrer gezählt.</p>
      <Stepper label="Freie Plätze" value={seats} min={1} max={MAX_SEATS} onChange={setSeats} />
      {offer?.riders.length ? (
        <>
          <p class="small muted">Es fahren mit. Wen du nicht mehr mitnehmen kannst, hier abwählen; die Familie wird benachrichtigt und sucht wieder.</p>
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
          {tooFew ? <p class="small" style={{ color: "var(--red)" }}>Es fahren {taken} Personen mit. Bitte mehr Plätze angeben oder Mitfahrer abwählen.</p> : null}
        </>
      ) : null}
      <Button variant="primary" size="lg" block disabled={tooFew || personId == null} onClick={save}>
        {offer ? "Speichern" : "Plätze anbieten"}
      </Button>
      {offer ? (
        <Button
          variant="ghost"
          icon="trash"
          onClick={async () => {
            const msg = offer.riders.length ? "Alle Mitfahrer werden benachrichtigt und suchen wieder." : "Das Angebot wird gelöscht.";
            if (!(await confirmDialog({ title: "Angebot zurückziehen?", message: msg, confirmLabel: "Zurückziehen", danger: true }))) return;
            await api.del(`${base}/${offer.personId}`);
            toast("Angebot zurückgezogen.");
            onClose();
            onDone();
          }}
        >
          Angebot zurückziehen
        </Button>
      ) : null}
    </Sheet>
  );
}

/** Mitfahrgelegenheit suchen und buchen; Trainer wählen den Spieler aus. */
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
  // Begleitung: die Eltern des Mitfahrers mit Namen (man selbst zuerst, mit „du“); Trainer fahren mit Begleitpersonen
  const rider = [...carpool.mine.map((m) => m.player), ...(carpool.coach?.riders ?? [])].find((r) => r.id === player?.id);
  const isCoach = !!rider?.coach;
  const guardians = [...(rider?.guardians ?? [])].sort((a, b) => Number(b.id === me.person.id) - Number(a.id === me.person.id));
  const fallback = isCoach ? ["Eine Begleitperson", "Zweite Begleitperson"] : guardians.length ? ["Weitere Begleitperson", "Weitere Begleitperson"] : ["Ein Elternteil", "Zweites Elternteil"];
  const labels = [0, 1].map((i) => {
    const g = guardians[i];
    return g ? (g.id === me.person.id ? `${g.name} (du)` : g.name) : fallback[i]!;
  });

  const ensureRequest = async () => {
    if (!player) return false;
    if (!target.request || target.request.companions !== companions) await api.put(`${base}/${player.id}`, { companions });
    return true;
  };

  return (
    <Sheet open onClose={onClose} title={target.asCoach ? "Mitfahrer eintragen" : "Mitfahrgelegenheit"}>
      {!target.player ? (
        <>
          <p class="muted">{target.asCoach ? "Wer braucht eine Mitfahrgelegenheit?" : "Für wen?"}</p>
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
          <p class="muted">Wer fährt mit?</p>
          <ul class="list">
            <li>
              <CheckRow label={self ? "Ich" : player.name} checked disabled />
            </li>
            {labels.map((label, i) => (
              <li key={i}>
                <CheckRow label={label} checked={extra[i]!} onToggle={() => setExtra(extra.map((v, j) => (j === i ? !v : v)))} />
              </li>
            ))}
          </ul>
          <p class="small muted">Gesucht: {seatsText(need)}</p>
          {offers.length ? (
            <div class="stack-sm">
              {offers.map((o) => (
                <div class="row-gap" style={{ justifyContent: "space-between" }} key={o.id}>
                  <span>
                    <strong>{o.name}</strong> <span class="small muted">{seatsText(o.free)} frei</span>
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (!(await ensureRequest())) return;
                      await api.put(`${base}/${player.id}/booking`, { offerId: o.id });
                      toast(`${self ? "Du fährst" : `${player.name} fährt`} bei ${o.name} mit. ${o.name.split(" ")[0]} wird benachrichtigt.`);
                      onClose();
                      onDone();
                    }}
                  >
                    Mitfahren
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p class="small muted">Gerade hat niemand genug Plätze frei.</p>
          )}
          {!target.request || target.request.companions !== companions ? (
            <Button
              block
              onClick={async () => {
                if (!(await ensureRequest())) return;
                toast("Gespeichert. Sobald jemand Plätze anbietet, gibt es eine Benachrichtigung.");
                onClose();
                onDone();
              }}
            >
              {target.request ? "Änderung speichern" : "Warten, bis jemand Plätze anbietet"}
            </Button>
          ) : null}
          {target.asCoach && target.request ? (
            <Button
              variant="ghost"
              icon="trash"
              onClick={async () => {
                await api.del(`${base}/${player.id}`);
                toast("Suche gelöscht.");
                onClose();
                onDone();
              }}
            >
              Suche löschen
            </Button>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
