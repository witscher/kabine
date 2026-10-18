import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName } from "./club";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { ParticipationStatus } from "../shared/types";
import { errorMessage } from "./api";
import { Icon, type IconName } from "./icons";

// Headers -------------------------------------------------------------------------

export function TopBar(props: { title: string; kicker?: ComponentChildren; back?: string | (() => void); actions?: ComponentChildren }) {
  const goBack = () => {
    if (typeof props.back === "function") props.back();
    else if (history.length > 1) history.back();
    else location.assign(props.back ?? "/");
  };
  return (
    <header class="topbar">
      {props.back !== undefined ? (
        <button type="button" class="icon-btn" aria-label={t`Back`} onClick={goBack}>
          <Icon name="back" size={24} stroke={2.2} />
        </button>
      ) : null}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: props.back === undefined ? "8px" : 0 }}>
        {props.kicker ? <div class="kicker">{props.kicker}</div> : null}
        <h1>{props.title}</h1>
      </div>
      {props.actions}
    </header>
  );
}

// Buttons -------------------------------------------------------------------------

type ButtonProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, "onClick" | "icon"> & {
  variant?: "primary" | "secondary" | "accent" | "danger" | "danger-solid" | "ghost" | "dashed";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: IconName;
  disabled?: boolean;
  type?: "button" | "submit";
  /** Asynchronous action: the button shows a loading state meanwhile, errors as a toast. */
  onClick?: (e: MouseEvent) => unknown;
};

export function Button({ variant = "secondary", size = "md", block, icon, children, onClick, disabled, type = "button", ...rest }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const cls = [
    "btn",
    variant === "primary" && "btn-primary",
    variant === "accent" && "btn-accent",
    variant === "danger" && "btn-danger",
    variant === "danger-solid" && "btn-danger-solid",
    variant === "ghost" && "btn-ghost",
    variant === "dashed" && "btn-dashed",
    size === "sm" && "btn-sm",
    size === "lg" && "btn-lg",
    block && "btn-block",
    rest.class,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      {...rest}
      type={type}
      class={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async (e) => {
        if (!onClick) return;
        const result = onClick(e as MouseEvent);
        if (result instanceof Promise) {
          setBusy(true);
          try {
            await result;
          } catch (err) {
            toast(errorMessage(err), "error");
          } finally {
            setBusy(false);
          }
        }
      }}
    >
      {icon ? <Icon name={icon} size={18} stroke={2.4} /> : null}
      {busy ? (
        <span>
          <Trans>Please wait …</Trans>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

// Toasts --------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  kind: "ok" | "error";
}

let toastSeq = 0;
let toastItems: ToastItem[] = [];
const toastListeners = new Set<() => void>();

export function toast(text: string, kind: "ok" | "error" = "ok") {
  const item = { id: ++toastSeq, text, kind };
  toastItems = [...toastItems, item];
  toastListeners.forEach((fn) => fn());
  setTimeout(
    () => {
      toastItems = toastItems.filter((x) => x.id !== item.id);
      toastListeners.forEach((fn) => fn());
    },
    kind === "error" ? 6000 : 3500,
  );
}

export function Toasts() {
  const [, setN] = useState(0);
  useEffect(() => {
    const fn = () => setN((n) => n + 1);
    toastListeners.add(fn);
    return () => void toastListeners.delete(fn);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toastItems.map((item) => (
        <div key={item.id} class={`toast ${item.kind === "error" ? "error" : ""}`}>
          <Icon name={item.kind === "error" ? "alert" : "check"} size={18} stroke={2.4} />
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

// Bottom Sheet --------------------------------------------------------------------

/**
 * Take focus out of the sheet before it closes. If a focused input disappears together with the
 * keyboard, the navigation bar otherwise stays shifted in the installed app on iOS.
 */
function blurInside(el: HTMLElement | null) {
  const active = document.activeElement;
  if (el && active instanceof HTMLElement && el.contains(active)) active.blur();
}

export function Sheet(props: { open: boolean; onClose: () => void; title: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) {
      blurInside(d);
      d.close();
    }
  }, [props.open]);
  // Also when the sheet with its input simply disappears: release focus first (see blurInside)
  useEffect(() => () => blurInside(ref.current), []);
  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby={id}
      onClose={props.onClose}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      {props.open ? (
        <div class="sheet-inner">
          <div class="sheet-grip" aria-hidden="true" />
          <div class="sheet-head">
            <h2 id={id}>{props.title}</h2>
            <button type="button" class="icon-btn" aria-label={t`Close`} onClick={props.onClose}>
              <Icon name="x" size={22} />
            </button>
          </div>
          {props.children}
        </div>
      ) : null}
    </dialog>
  );
}

// Confirmation dialog (promise-based) ----------------------------------------------------

interface ConfirmOptions {
  title: string;
  message: ComponentChildren;
  confirmLabel?: string;
  danger?: boolean;
}

let confirmState: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null = null;
const confirmListeners = new Set<() => void>();

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState = { ...options, resolve };
    confirmListeners.forEach((fn) => fn());
  });
}

export function ConfirmHost() {
  const [, setN] = useState(0);
  useEffect(() => {
    const fn = () => setN((n) => n + 1);
    confirmListeners.add(fn);
    return () => void confirmListeners.delete(fn);
  }, []);
  const state = confirmState;
  const close = (ok: boolean) => {
    state?.resolve(ok);
    confirmState = null;
    confirmListeners.forEach((fn) => fn());
  };
  return (
    <Sheet open={!!state} onClose={() => close(false)} title={state?.title ?? ""}>
      <div class="muted">{state?.message}</div>
      <div class="btn-row">
        <Button onClick={() => close(false)}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant={state?.danger ? "danger-solid" : "primary"} onClick={() => close(true)}>
          {state?.confirmLabel ?? t`Confirm`}
        </Button>
      </div>
    </Sheet>
  );
}

// Form elements -------------------------------------------------------------------

export function Field(props: { label: string; hint?: ComponentChildren; error?: string | null; children: (id: string) => ComponentChildren }) {
  const id = useId();
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {props.label}
      </label>
      {props.children(id)}
      {props.error ? <div class="field-error">{props.error}</div> : props.hint ? <div class="field-hint">{props.hint}</div> : null}
    </div>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  hint?: ComponentChildren;
  error?: string | null;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text" | "url" | "email";
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      {(id) => (
        <input
          id={id}
          class="input"
          type={props.type ?? "text"}
          value={props.value}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete ?? "off"}
          inputMode={props.inputMode}
          maxLength={props.maxLength}
          required={props.required}
          aria-invalid={props.error ? "true" : undefined}
          onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
        />
      )}
    </Field>
  );
}

export function SwitchRow(props: { label: ComponentChildren; sub?: ComponentChildren; checked: boolean; onChange: (v: boolean) => unknown; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      class="switch-row"
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      disabled={props.disabled || busy}
      onClick={async () => {
        const r = props.onChange(!props.checked);
        if (r instanceof Promise) {
          setBusy(true);
          try {
            await r;
          } catch (err) {
            toast(errorMessage(err), "error");
          } finally {
            setBusy(false);
          }
        }
      }}
    >
      <span class="main">
        <span style={{ display: "block", fontWeight: 600 }}>{props.label}</span>
        {props.sub ? <span class="small muted">{props.sub}</span> : null}
      </span>
      <span class="switch" aria-hidden="true" />
    </button>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" aria-pressed={props.value === o.value ? "true" : "false"} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// States ------------------------------------------------------------------------

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status">
      <div class="spinner" aria-hidden="true" />
      <span class="sr-only">{label ?? t`Loading …`}</span>
    </div>
  );
}

export function Empty(props: { title: string; children?: ComponentChildren; icon?: IconName }) {
  return (
    <div class="empty">
      {props.icon ? <Icon name={props.icon} size={36} stroke={1.6} /> : null}
      <div class="title">{props.title}</div>
      {props.children ? <div>{props.children}</div> : null}
    </div>
  );
}

export function ErrorBox(props: { error: unknown; onRetry?: () => void }) {
  return (
    <div class="notice warn" role="alert">
      <Icon name="alert" />
      <div class="stack-sm" style={{ flex: 1 }}>
        <span>{errorMessage(props.error)}</span>
        {props.onRetry ? (
          <button type="button" class="link-btn" style={{ color: "inherit", alignSelf: "flex-start" }} onClick={props.onRetry}>
            <Trans>Try again</Trans>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Notice(props: { kind?: "info" | "warn" | "yellow"; icon?: IconName; children: ComponentChildren }) {
  return (
    <div class={`notice ${props.kind === "warn" ? "warn" : props.kind === "yellow" ? "yellow" : ""}`}>
      <Icon name={props.icon ?? (props.kind === "warn" ? "alert" : "info")} size={18} />
      <div>{props.children}</div>
    </div>
  );
}

// Status ------------------------------------------------------------------------

export function StatusPill(props: { status: ParticipationStatus | null; late?: boolean; nominated?: boolean; game?: boolean; optional?: boolean }) {
  const { status } = props;
  // Optional training without acceptance: neither open nor declined
  if (props.optional && (status === "open" || status === "no"))
    return (
      <span class="pill pill-muted">
        <Trans context="training">Optional</Trans>
      </span>
    );
  if (status === "yes")
    return (
      <span class="pill pill-yes">
        <Trans>Accepted</Trans>
      </span>
    );
  if (status === "no")
    return props.late ? (
      <span class="pill pill-late">
        <Trans>Declined at short notice</Trans>
      </span>
    ) : (
      <span class="pill pill-no">
        <Trans>Declined</Trans>
      </span>
    );
  if (status === "standing")
    return (
      <span class="pill pill-muted">
        <Trans>Away long-term</Trans>
      </span>
    );
  if (status === "inactive")
    return (
      <span class="pill pill-muted">
        <Trans>Inactive</Trans>
      </span>
    );
  if (props.game && props.nominated)
    return (
      <span class="pill pill-nominated">
        <Trans>Nominated</Trans>
      </span>
    );
  if (status === "open")
    return (
      <span class="pill pill-open">
        <Trans context="participation">Open</Trans>
      </span>
    );
  return null;
}

export function Avatar(props: { name: string; coach?: boolean; src?: string | null; size?: number }) {
  const style = props.size ? { width: `${props.size}px`, height: `${props.size}px`, fontSize: `${Math.round(props.size * 0.4)}px` } : undefined;
  return (
    <div class={`avatar ${props.coach ? "coach" : ""}`} style={style} aria-hidden="true">
      {props.src ? <img src={props.src} alt="" loading="lazy" decoding="async" /> : props.name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${clubName()}` : clubName();
  }, [title]);
}


export async function copyText(text: string, done?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done ?? t`Copied.`);
  } catch {
    toast(t`Copying not possible. Please select the text.`, "error");
  }
}

/** Share via the device's share menu; without url the link is already in the text. Without a share menu it is copied. */
export async function shareLink(title: string, text: string, url: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share(url ? { title, text, url } : { title, text });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  await copyText(url || text);
}
