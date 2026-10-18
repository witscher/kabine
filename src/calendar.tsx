// Profil → Meine Termine: persönlicher Kalender als Abo-Link mit Häkchen für Training,
// Spiele und Helferdienste (Server: worker/routes/calendar.ts).
import { useState } from "preact/hooks";
import { api } from "./api";
import { useMe } from "./session";
import { useQuery } from "./store";
import { Button, confirmDialog, copyText, Notice, Sheet, SwitchRow, toast } from "./ui";

interface CalendarPrefs {
  training: boolean;
  games: boolean;
  duties: boolean;
}

interface CalendarState extends CalendarPrefs {
  hasCalendar: boolean;
}

export function MyCalendar() {
  const me = useMe();
  const { data, mutate } = useQuery<CalendarState>("/profile/calendar");
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const showDuties = me.helperTeams.length > 0 || me.referee;
  const set = async (key: keyof CalendarPrefs, value: boolean) => {
    const next = { ...data, [key]: value };
    // Mit Link sofort speichern, ohne Link beim Erzeugen mitschicken
    if (data.hasCalendar) await api.put("/profile/calendar", { training: next.training, games: next.games, duties: next.duties });
    mutate(next);
  };
  return (
    <section class="stack-sm" aria-label="Meine Termine">
      <h2 class="section-title">Meine Termine</h2>
      <p class="small muted">Deine Termine als Kalender auf dem Handy, immer aktuell. Wähle, was drinstehen soll.</p>
      <ul class="list">
        <li>
          <SwitchRow label="Training und weitere Termine" checked={data.training} onChange={(v) => set("training", v)} />
        </li>
        <li>
          <SwitchRow label="Spiele" sub="Alle Spiele deiner Mannschaften, mit Treffpunkt, wenn du nominiert bist" checked={data.games} onChange={(v) => set("games", v)} />
        </li>
        {showDuties ? (
          <li>
            <SwitchRow label="Helferdienste" checked={data.duties} onChange={(v) => set("duties", v)} />
          </li>
        ) : null}
      </ul>
      <Button icon="calendar" onClick={() => setOpen(true)}>
        {data.hasCalendar ? "Kalender-Link" : "Im Kalender abonnieren"}
      </Button>
      {open ? (
        <CalendarSheet
          state={data}
          onClose={() => setOpen(false)}
          onChange={(hasCalendar) => mutate({ ...data, hasCalendar })}
        />
      ) : null}
    </section>
  );
}

function CalendarSheet(props: { state: CalendarState; onClose: () => void; onChange: (hasCalendar: boolean) => void }) {
  const { state } = props;
  const [url, setUrl] = useState<string | null>(null);
  const webcal = url?.replace(/^https?:/, "webcal:");
  const create = async () => {
    const res = await api.post<{ url: string }>("/profile/calendar-token", { training: state.training, games: state.games, duties: state.duties });
    setUrl(res.url);
    props.onChange(true);
  };
  return (
    <Sheet open onClose={props.onClose} title="Meine Termine im Kalender">
      <p class="muted">
        Mit einem persönlichen Link erscheinen deine Termine in der Kalender-App deines Handys und bleiben aktuell. Den Link nicht weitergeben: Wer ihn hat, sieht deine
        Termine.
      </p>
      {url ? (
        <div class="stack-sm">
          <a class="btn btn-primary" href={webcal}>
            Im Kalender abonnieren
          </a>
          <div class="url-box">{url}</div>
          <div class="btn-row">
            <Button icon="copy" onClick={() => copyText(url, "Link kopiert.")}>
              Link kopieren
            </Button>
            <a class="btn" href={url} download="kabine.ics">
              Als Datei laden
            </a>
          </div>
          <p class="small muted">Klappt das Abonnieren nicht, den Link kopieren und in der Kalender-App unter „Kalender abonnieren“ bzw. „Per URL hinzufügen“ einfügen.</p>
          <p class="small muted">
            Google Kalender: am Computer unter calendar.google.com → Weitere Kalender → Per URL den Link einfügen. Danach erscheint er auch in der App. Google
            aktualisiert nur alle paar Stunden.
          </p>
        </div>
      ) : state.hasCalendar ? (
        <div class="stack-sm">
          <Notice>
            Du hast schon einen Kalender-Link. Aus Sicherheitsgründen zeigt die App ihn nicht noch einmal. Ein neuer Link macht den alten ungültig, dann musst du neu
            abonnieren.
          </Notice>
          <Button variant="primary" icon="calendar" onClick={create}>
            Neuen Link erzeugen
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await confirmDialog({ title: "Kalender-Link entfernen?", message: "Der Kalender auf deinen Geräten wird danach nicht mehr aktualisiert.", confirmLabel: "Entfernen", danger: true })))
                return;
              await api.del("/profile/calendar-token");
              props.onChange(false);
              toast("Kalender-Link entfernt.");
              props.onClose();
            }}
          >
            Link entfernen
          </Button>
        </div>
      ) : (
        <Button variant="primary" icon="calendar" onClick={create}>
          Link erzeugen
        </Button>
      )}
    </Sheet>
  );
}
