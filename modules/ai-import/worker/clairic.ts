// Calls Cloudflare's extraction model Clairic through the club's own Workers AI binding. Text answers are
// spans of the input, so the model cannot invent a name; every answer comes with a confidence.
// https://developers.cloudflare.com/workers-ai/models/clairic/
import { t } from "@lingui/core/macro";
import { ApiError } from "../../../worker/lib/http";

export const CLAIRIC = "@cf/cloudflare/clairic";

export interface ClairicAnswer {
  value: string | number | null;
  confidence?: number;
}

export type ClairicField =
  | { type: "text"; instructions: string }
  | { type: "number"; decimals: number; instructions: string };

export async function clairic(env: Env, state: string, fields: Record<string, ClairicField>): Promise<Record<string, ClairicAnswer>> {
  if (!env.AI) throw new ApiError(503, "ai_unavailable", t`Workers AI is not set up in this installation.`);
  const res = (await env.AI.run(CLAIRIC as never, { model: "clairic", state, fields } as never)) as { answers?: Record<string, ClairicAnswer> };
  return res.answers ?? {};
}
