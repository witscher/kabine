import type { ApiErrorBody } from "../shared/types";
import { noteNetworkError, noteResponse } from "./offline";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      // FormData setzt den Content-Type (multipart mit Boundary) selbst
      headers: body instanceof FormData ? undefined : body instanceof Blob ? { "content-type": body.type } : body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body instanceof FormData || body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    noteNetworkError();
    throw new ApiError(0, "offline", "Keine Verbindung. Bitte prüfe deine Internetverbindung.");
  }
  noteResponse(res);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("kabine:unauthorized"));
    if (res.status === 503 && err?.code === "maintenance") window.dispatchEvent(new CustomEvent("kabine:maintenance"));
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Es ist ein Fehler aufgetreten.");
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  patch: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  del: <T = { ok: true }>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  /** Datei unverändert hochladen (z. B. ein Bild). */
  upload: <T = { ok: true }>(path: string, file: Blob) => request<T>("PUT", path, file),
  /** Formular mit Dateien (multipart). */
  form: <T = { ok: true }>(path: string, form: FormData) => request<T>("POST", path, form),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof DOMException && err.name === "NotAllowedError") return "Der Vorgang wurde abgebrochen.";
  if (err instanceof Error && err.message) return err.message;
  return "Es ist ein Fehler aufgetreten.";
}
