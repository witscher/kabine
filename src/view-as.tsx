// Nur für Admins (vom Server geprüft): ?playerview=1, ?parentview=1, ?trainerview=1
// setzen die Sicht als Cookie, das Banner beendet sie wieder.
import { clearCache } from "./store";
import { useSession } from "./session";

const COOKIE = "kabine_view";
const FLAGS = { playerview: "player", parentview: "parent", trainerview: "trainer", refereeview: "referee" } as const;
const LABEL = { player: "Spieler/in", parent: "Elternteil", trainer: "Trainer/in", referee: "KiHaSL/JuHaSL" } as const;

function setCookie(value: string | null) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = value ? `${COOKIE}=${value}; Path=/; SameSite=Lax${secure}` : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/** Vor dem ersten Laden: Flag aus der Adresse übernehmen und aus der Adresse entfernen. */
export function applyViewFlags() {
  const params = new URLSearchParams(location.search);
  const flag = (Object.keys(FLAGS) as (keyof typeof FLAGS)[]).find((f) => params.get(f) === "1");
  if (!flag) return;
  setCookie(FLAGS[flag]);
  for (const f of Object.keys(FLAGS)) params.delete(f);
  const rest = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
}

export function ViewAsBanner() {
  const { me } = useSession();
  const view = me?.viewAs;
  if (!view) return null;
  const end = () => {
    setCookie(null);
    clearCache();
    location.assign("/");
  };
  return (
    <div class="view-banner" role="note">
      <span>
        Ansicht als {LABEL[view.mode]}: {me.person.firstName}
        {view.readOnly ? " · nur lesen" : ""}
      </span>
      <button type="button" onClick={end}>
        Beenden
      </button>
    </div>
  );
}
