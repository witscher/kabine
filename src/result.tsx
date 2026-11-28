// The result of a played game (docs/dev/decisions.md, "Results in the event list"): the score large and next to it a
// white rounded box with the outcome word ("Win", "Draw", "Loss") and, for users under 14, the club mascot's face for it
// (mascot module). The word only where the league has a table (GameInfo.inTable); without a known side only the score.
import { t } from "@lingui/core/macro";
import { type Outcome, outcome } from "../shared/result";
import { useMascotImage } from "./modules";
import { useMe } from "./session";

const word = (o: Outcome) =>
  o === "win"
    ? t({ message: "Win", context: "game outcome" })
    : o === "draw"
      ? t({ message: "Draw", context: "game outcome" })
      : t({ message: "Loss", context: "game outcome" });

/** Read out when only the face shows (no table): the face tells close from clear. */
const label = (o: Outcome) =>
  o === "win"
    ? t({ message: "Won", context: "game outcome" })
    : o === "draw"
      ? t({ message: "Drawn", context: "game outcome" })
      : o === "close"
        ? t`Lost narrowly`
        : t`Lost clearly`;

export function ResultLine({
  home,
  guest,
  isHome,
  inTable,
  size = "list",
}: {
  home: number;
  guest: number;
  isHome: boolean | null;
  inTable: boolean;
  /** "page": larger, on the game page and the fan game page */
  size?: "list" | "page";
}) {
  const o = outcome(home, guest, isHome);
  // Faces only for users under 14 (the server sends only the flag), and only while the mascot has one for this outcome
  const young = useMe().young;
  const face = useMascotImage(o ?? "win");
  const img = young && o ? face : null;
  return (
    <div class={`result-line result-${size}`}>
      <span class="result-big">
        {home}:{guest}
      </span>
      {o && (inTable || img) ? (
        <span class={`result-box ${img ? "" : "no-face"}`} role="img" aria-label={inTable ? word(o) : label(o)}>
          {inTable ? <span class={`result-word result-${o === "win" ? "win" : o === "draw" ? "draw" : "loss"}`}>{word(o)}</span> : null}
          {img ? <img src={img} alt="" width={38} height={38} decoding="async" /> : null}
        </span>
      ) : null}
    </div>
  );
}
