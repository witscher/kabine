// Help for the list import of the setup wizard: the column headers of a sheet, with masked samples where a
// column has none (shared/list-import.ts, assistInput), read by Clairic and answered right away. Nothing is
// stored or logged. Names and birth years never come here: Clairic is a preview, and most players are children.
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../../../worker/app";
import { requireAdmin } from "../../../worker/auth/actor";
import { parse, readJson } from "../../../worker/lib/http";
import type { ImportField } from "../../../shared/list-import";
import { clairic, type ClairicAnswer, type ClairicField } from "./clairic";

/** The model call, a parameter so that tests can answer in its place. */
export type Run = (state: string, fields: Record<string, ClairicField>) => Promise<Record<string, ClairicAnswer>>;

export const routes = new Hono<AppEnv>();

/** Below this the answer is left to the rules and the admin. */
const SURE = 0.6;
const sure = (a: ClairicAnswer | undefined) => (a && a.value != null && (a.confidence ?? 0) >= SURE ? a.value : null);

// Clairic answers with a part of the input, so the kinds are listed in the input and it picks one per column
const KINDS: [string, ImportField, string][] = [
  ["full_name", "name", "the name of a person, first and last name together, e.g. Xxxxxx, Xxxx"],
  ["first_name", "firstName", "only the first name"],
  ["last_name", "lastName", "only the last name"],
  ["birth_year", "birthYear", "a year of birth or a full date of birth, e.g. 2014 or 03.05.2014"],
  ["team", "team", "the team or age group a person plays in, often codes like xX1, xX, X13, Xxxxx 1"],
  ["role", "role", "whether a person is a player, coach or helper"],
  ["other", "ignore", "anything else, e.g. numbers, phone, address, remarks"],
];

const columnsSchema = z.object({
  header: z.array(z.string().max(80)).min(1).max(60),
  samples: z.array(z.array(z.string().max(80)).max(60)).max(3),
});

/** A field per column from the headers ("Column 3: Jg."), and samples where a column has no header. */
export async function readColumns(run: Run, header: string[], samples: string[][]): Promise<ImportField[]> {
  const columns = header.map((h, i) => {
    const examples = samples.map((r) => r[i]).filter(Boolean);
    return `Column ${i + 1}: ${h || "(no header)"}${examples.length ? ` (examples: ${examples.join("; ")})` : ""}`;
  });
  const state = [
    "A sports club's list of players and coaches. In the examples every letter is replaced by X or x; digits and punctuation are kept.",
    "Kinds of columns:",
    ...KINDS.map(([kind, , what]) => `${kind}: ${what}`),
    "",
    ...columns,
  ].join("\n");
  const answers = await run(
    state,
    Object.fromEntries(header.map((_, i) => [`column_${i + 1}`, { type: "text", instructions: `The kind of Column ${i + 1}: one of the kind names from the list` }])),
  );
  return header.map((_, i) => KINDS.find(([kind]) => kind === sure(answers[`column_${i + 1}`]))?.[1] ?? "ignore");
}

routes.post("/ai-import/columns", async (c) => {
  requireAdmin(requireActor(c));
  const { header, samples } = parse(columnsSchema, await readJson(c.req.raw));
  return c.json({ mapping: await readColumns((state, fields) => clairic(c.env, state, fields), header, samples) });
});
