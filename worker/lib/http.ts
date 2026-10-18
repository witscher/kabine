import type { z } from "zod";

/** Fehler, die als JSON mit deutscher Meldung an den Client gehen. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request") => new ApiError(400, code, message);
export const unauthorized = (message = "Bitte melde dich an.") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "Dafür fehlt dir die Berechtigung.", code = "forbidden") => new ApiError(403, code, message);
export const notFound = (message = "Nicht gefunden.") => new ApiError(404, "not_found", message);
export const conflict = (message: string, code = "conflict") => new ApiError(409, code, message);
export const gone = (message: string, code = "gone") => new ApiError(410, code, message);

/** Validiert Eingaben mit Zod und wirft bei Fehlern einen 400 mit lesbarer Meldung. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    const message = issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "Ungültige Eingabe.";
    throw new ApiError(400, "invalid_input", field ? `${message} (${field})` : message);
  }
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw badRequest("Erwarte JSON.");
  try {
    return await request.json();
  } catch {
    throw badRequest("Ungültiges JSON.");
  }
}
