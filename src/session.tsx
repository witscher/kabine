import { t } from "@lingui/core/macro";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import type { Me, SessionResponse } from "../shared/types";
import { api, errorMessage } from "./api";
import { adoptAccountLocale } from "./i18n";
import { refreshBadge, setBadge } from "./badge";
import { clearOfflineData } from "./offline";
import { clearCache } from "./store";

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  me: null,
  loading: true,
  refresh: async () => null,
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<SessionResponse>("/session");
      const next = res.authenticated ? res.me : null;
      setMe(next);
      // The language chosen on the account (also on another device) wins over this device
      if (next) adoptAccountLocale(next.locale, (locale) => void api.put("/me/locale", { locale }).catch(() => undefined));
      if (next) refreshBadge();
      else setBadge(0);
      return next;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    clearCache();
    await clearOfflineData();
    setBadge(0);
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setMe(null);
      void clearOfflineData();
    };
    const onOnline = () => void refresh();
    window.addEventListener("kabine:online", onOnline);
    window.addEventListener("kabine:unauthorized", onUnauthorized);
    // Check the session when returning to the app (sliding extension).
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("kabine:unauthorized", onUnauthorized);
      window.removeEventListener("kabine:online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return <SessionContext.Provider value={{ me, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error(t`Not signed in`);
  return me;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

// iOS starts the passkey dialog only while the permission from the tap is
// still valid. A network request between tap and dialog can use it up,
// especially in the installed app. So the options are prepared beforehand
// and kept after a cancellation for the next attempt.

interface Prepared<T> {
  key: string;
  challengeId: string;
  options: T;
  at: number;
}

/** Challenges are valid on the server for 5 minutes. */
const PREPARED_MAX_AGE_MS = 4 * 60_000;

let preparedLogin: Prepared<PublicKeyCredentialRequestOptionsJSON> | null = null;
let preparedRegistration: Prepared<PublicKeyCredentialCreationOptionsJSON> | null = null;

function fresh<T>(prepared: Prepared<T> | null, key: string): Prepared<T> | null {
  return prepared && prepared.key === key && Date.now() - prepared.at < PREPARED_MAX_AGE_MS ? prepared : null;
}

async function fetchLoginOptions(): Promise<Prepared<PublicKeyCredentialRequestOptionsJSON>> {
  const res = await api.post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>("/auth/login/options");
  preparedLogin = { key: "login", ...res, at: Date.now() };
  return preparedLogin;
}

/** Fetch login options in advance, e.g. when opening the sign-in page. */
export async function prepareLogin(): Promise<void> {
  await fetchLoginOptions().catch(() => undefined);
}

/** Passkey login. Must be called from a tap. */
export async function loginWithPasskey(): Promise<void> {
  const ready = fresh(preparedLogin, "login");
  const prepared = ready ?? (await fetchLoginOptions());
  let response;
  try {
    response = await startAuthentication({ optionsJSON: prepared.options });
  } catch (err) {
    reportPasskeyError("login", err, ready ? Date.now() - ready.at : null);
    throw err;
  }
  preparedLogin = null;
  await api.post("/auth/login/verify", { challengeId: prepared.challengeId, response });
}

async function fetchRegistrationOptions(base: string, body: Record<string, unknown>): Promise<Prepared<PublicKeyCredentialCreationOptionsJSON>> {
  const res = await api.post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(`${base}/options`, body);
  preparedRegistration = { key: `${base} ${JSON.stringify(body)}`, ...res, at: Date.now() };
  return preparedRegistration;
}

/** Fetch registration options in advance, as soon as it is clear whom the passkey is for. */
export async function prepareRegistration(base: string, body: Record<string, unknown>): Promise<void> {
  await fetchRegistrationOptions(base, body).catch(() => undefined);
}

/** Passkey registration via an endpoint pair …/options and …/verify. */
export async function registerPasskey(base: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ready = fresh(preparedRegistration, `${base} ${JSON.stringify(body)}`);
  const prepared = ready ?? (await fetchRegistrationOptions(base, body));
  let response;
  try {
    response = await startRegistration({ optionsJSON: prepared.options });
  } catch (err) {
    reportPasskeyError("register", err, ready ? Date.now() - ready.at : null);
    throw err;
  }
  preparedRegistration = null;
  return api.post<Record<string, unknown>>(`${base}/verify`, { challengeId: prepared.challengeId, response });
}

/** Reports a failed passkey dialog to the server (technical only, no personal data). */
function reportPasskeyError(kind: "login" | "register", err: unknown, preparedAgeMs: number | null) {
  const body = {
    kind,
    name: err instanceof Error ? err.name : "unknown",
    message: err instanceof Error ? err.message.slice(0, 300) : "",
    standalone: isStandalone(),
    preparedAgeMs,
  };
  void fetch("/api/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}

/** Technical cause, shown below the message. */
export function passkeyErrorDetail(err: unknown): string {
  if (!(err instanceof Error)) return "";
  const cause = (err as Error & { cause?: unknown }).cause;
  const base = cause instanceof Error ? cause : err;
  return `${base.name}: ${base.message}`;
}

/** Understandable message for errors from the passkey dialog. */
export function passkeyErrorMessage(err: unknown, kind: "login" | "register"): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return kind === "login"
      ? t`The device rejected the sign-in with the passkey or it was cancelled. Please tap again.`
      : t`The passkey was not created because the dialog was cancelled. Please tap again.`;
  }
  if (name === "InvalidStateError") return t`This device already has a passkey for this access. Sign in with it.`;
  return errorMessage(err);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone, but not Safari (Chrome, Firefox, Edge …). Passkeys may then not end up in the iCloud Keychain. */
export function isIosOtherBrowser(): boolean {
  return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
