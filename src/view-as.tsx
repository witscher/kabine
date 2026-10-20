// Admins only (checked by the server): ?playerview=1, ?parentview=1, ?trainerview=1
// set the view as a cookie, the banner ends it again.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clearCache } from "./store";
import { useSession } from "./session";

const COOKIE = "kabine_view";
const FLAGS = { playerview: "player", parentview: "parent", trainerview: "trainer", refereeview: "referee" } as const;
const labels = () =>
  ({
    player: t({ message: "player", context: "view as" }),
    parent: t({ message: "parent", context: "view as" }),
    trainer: t({ message: "coach", context: "view as" }),
    referee: t({ message: "youth referee", context: "view as" }),
  }) as const;

function setCookie(value: string | null) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = value ? `${COOKIE}=${value}; Path=/; SameSite=Lax${secure}` : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/** Before the first load: take the flag from the address and remove it from the address. */
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
  const mode = labels()[view.mode];
  const name = me.person.firstName;
  return (
    <div class="view-banner" role="note">
      <span>{view.readOnly ? t`View as ${mode}: ${name} · read only` : t`View as ${mode}: ${name}`}</span>
      <button type="button" onClick={end}>
        <Trans>End</Trans>
      </button>
    </div>
  );
}
