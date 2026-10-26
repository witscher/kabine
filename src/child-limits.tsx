// Children in the app: the four controls for what players of a youth class may do themselves, used for
// age classes (admins) and teams (coaches). `max` is the age class's limit a team cannot go beyond.
import { t } from "@lingui/core/macro";
import type { ChildChat, ChildLimits } from "../shared/types";

export const FULL_LIMITS: ChildLimits = { account: true, respond: true, chat: "write", help: true };

const CHAT_RANK: Record<ChildChat, number> = { none: 0, read: 1, write: 2 };

/** Without an own account nothing themselves either. */
export function normalizeLimits(l: ChildLimits): ChildLimits {
  return l.account ? l : { account: false, respond: false, chat: "none", help: false };
}

export const chatLabels = (): Record<ChildChat, string> => ({ none: t`No`, read: t`Read`, write: t`Read and write` });

export function ChildLimitControls(props: { value: ChildLimits; max?: ChildLimits; onChange: (l: ChildLimits) => unknown; name: string; disabled?: boolean }) {
  const { value: l, max = FULL_LIMITS, name } = props;
  // Own access back on: everything else up to the limit as well, since without access it was all off
  const set = (patch: Partial<ChildLimits>) =>
    props.onChange(normalizeLimits(patch.account && !l.account ? { ...max, account: true } : { ...l, ...patch }));
  const box = (key: "account" | "respond" | "help", label: string, aria: string) => {
    const off = props.disabled || !max[key] || (key !== "account" && !l.account);
    return (
      <label class="row-gap small" style={{ gap: "6px", opacity: off ? 0.5 : 1 }}>
        <input type="checkbox" style={{ width: "20px", height: "20px" }} checked={l.account && l[key]} disabled={off} aria-label={aria} onChange={(e) => set({ [key]: (e.target as HTMLInputElement).checked })} />
        {label}
      </label>
    );
  };
  const labels = chatLabels();
  return (
    <div class="row-gap" style={{ flexWrap: "wrap", gap: "8px 16px", alignItems: "center" }}>
      {box("account", t`Own access`, t`Own access ${name}`)}
      {box("respond", t`Respond`, t`Respond themselves ${name}`)}
      <label class="row-gap small" style={{ gap: "6px", opacity: l.account && !props.disabled ? 1 : 0.5 }}>
        {t`Chat`}
        <select
          class="select"
          style={{ minHeight: "36px", width: "auto" }}
          value={l.account ? l.chat : "none"}
          disabled={props.disabled || !l.account}
          aria-label={t`Chat ${name}`}
          onChange={(e) => set({ chat: (e.target as HTMLSelectElement).value as ChildChat })}
        >
          {(["none", "read", "write"] as ChildChat[]).map((c) => (
            <option value={c} disabled={CHAT_RANK[c] > CHAT_RANK[max.chat]}>
              {labels[c]}
            </option>
          ))}
        </select>
      </label>
      {box("help", t`Stand-in requests`, t`Answer stand-in requests ${name}`)}
    </div>
  );
}

/** "Own access off; responding, chat …" as one sentence for parents and coaches. */
export function describeLimits(l: ChildLimits, firstName: string): string {
  if (!l.account) return t`${firstName} has no own access there; you respond and are in the chat`;
  const parts = [!l.respond ? t`responses` : null, l.chat === "none" ? t`the chat` : l.chat === "read" ? t`writing in the chat` : null, !l.help ? t`stand-in requests` : null].filter(
    (p): p is string => !!p,
  );
  const list = parts.join(", ");
  return t`you take care of ${list} there`;
}
