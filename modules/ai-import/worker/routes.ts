// Help for the list import of the setup wizard: column headers and unclear name cells, sent by the admin's
// browser one request at a time, read by Clairic and answered right away. Nothing is stored.
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../../../worker/app";
import { requireAdmin } from "../../../worker/auth/actor";
import { parse, readJson } from "../../../worker/lib/http";
import { type ImportField, parseYear } from "../../../shared/list-import";
import { clairic, type ClairicAnswer, type ClairicField } from "./clairic";

/** The model call, a parameter so that tests can answer in its place. */
export type Run = (state: string, fields: Record<string, ClairicField>) => Promise<Record<string, ClairicAnswer>>;

export const routes = new Hono<AppEnv>();

/** Below this the answer is left to the rules and the admin. */
const SURE = 0.6;
const sure = (a: ClairicAnswer | undefined) => (a && a.value != null && (a.confidence ?? 0) >= SURE ? a.value : null);

// Clairic answers with a part of the input, so the kinds are listed in the input and it picks one per column
const KINDS: [string, ImportField, string][] = [
  ["full_name", "name", "the name of a person, first and last name together"],
  ["first_name", "firstName", "only the first name"],
  ["last_name", "lastName", "only the last name"],
  ["birth_year", "birthYear", "a year of birth"],
  ["birth_date", "birthDate", "a full date of birth"],
  ["team", "team", "the team or age group a person plays in, often codes like wD1, mC, U13, Damen 1"],
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
    "A sports club's list of players and coaches.",
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

const namesSchema = z.object({ cells: z.array(z.string().trim().min(1).max(120)).min(1).max(100) });

/** First name, last name and birth year of one name cell as written; null if the model is unsure. */
export async function readName(run: Run, cell: string): Promise<{ firstName: string; lastName: string; birthYear: number | null } | null> {
  const a = await run(`Name: ${cell}`, {
    first_name: { type: "text", instructions: "First name(s) of the person (Vorname)" },
    last_name: { type: "text", instructions: "Last name of the person including particles such as van, von, de (Nachname)" },
    birth_year: { type: "number", decimals: 0, instructions: "Year of birth if written; a two-digit year like 14 means 2014" },
  });
  const firstName = sure(a.first_name);
  const lastName = sure(a.last_name);
  if (typeof firstName !== "string" || typeof lastName !== "string") return null;
  const year = sure(a.birth_year);
  return { firstName, lastName, birthYear: year == null ? null : parseYear(String(year)) };
}

routes.post("/ai-import/names", async (c) => {
  requireAdmin(requireActor(c));
  const { cells } = parse(namesSchema, await readJson(c.req.raw));
  const run: Run = (state, fields) => clairic(c.env, state, fields);
  // A few at a time: one model call per cell keeps every answer tied to its own cell
  const names: Awaited<ReturnType<typeof readName>>[] = [];
  for (let i = 0; i < cells.length; i += 6) names.push(...(await Promise.all(cells.slice(i, i + 6).map((cell) => readName(run, cell)))));
  return c.json({ names });
});
