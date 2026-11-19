// Administration → Polls: polls of the whole club and the payment details for every order in the club.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../../src/api";
import { Icon } from "../../../src/icons";
import { useMe } from "../../../src/session";
import { invalidate, useQuery } from "../../../src/store";
import { Button, ErrorBox, Field, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../../../src/ui";
import { CURRENCIES, type PollPayment } from "../types";

export function AdminPollsPage() {
  useDocumentTitle(t`Polls`);
  const me = useMe();
  return (
    <main class="page">
      <TopBar title={t`Polls`} kicker={t`Administration`} back="/verwaltung" />
      <div class="content">
        <ul class="list">
          <li>
            <a class="list-row" href="/umfragen?verein">
              <Icon name="poll" size={22} />
              <span class="main">
                <span class="title">
                  <Trans>Polls of the whole club</Trans>
                </span>
                <span class="sub">
                  <Trans>Ask all teams at once, create and manage</Trans>
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        </ul>
        {me.isAdmin ? <PaymentSettings /> : null}
      </div>
    </main>
  );
}

interface Draft {
  paypal: string;
  holder: string;
  iban: string;
  currency: string;
}

const toDraft = (p: PollPayment): Draft => ({ paypal: p.paypal ?? "", holder: p.holder ?? "", iban: p.iban ?? "", currency: p.currency });

function PaymentSettings() {
  const { data, error, reload, mutate } = useQuery<PollPayment>("/polls/payment");
  const [value, setValue] = useState<Draft | null>(null);
  useEffect(() => {
    if (data && !value) setValue(toDraft(data));
  }, [data]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!value) return <Spinner />;
  return (
    <section class="card card-body stack-sm" aria-label={t`Payment for orders`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Payment for orders</Trans>
      </h2>
      <p class="small muted">
        <Trans>
          Applies to every order in the club, including the coaches' ones. Whoever ordered sees the amount, a PayPal button with the amount and, for a bank transfer,
          the IBAN and reference with a QR code (euros only). The reference is the title with the order number, e.g. “Club kit No. 17”, without names. For PayPal the
          app copies a note with the order number and the players' names.
        </Trans>
      </p>
      <TextField label={t`PayPal.me name`} value={value.paypal} onInput={(paypal) => setValue({ ...value, paypal })} maxLength={80} placeholder={t`e.g. paypal.me/yourclub`} />
      <TextField label={t`Account holder`} value={value.holder} onInput={(holder) => setValue({ ...value, holder })} maxLength={70} />
      <TextField label="IBAN" value={value.iban} onInput={(iban) => setValue({ ...value, iban })} maxLength={42} />
      <Field label={t`Currency`}>
        {(fid) => (
          <select id={fid} class="input" value={value.currency} onChange={(e) => setValue({ ...value, currency: (e.target as HTMLSelectElement).value })}>
            {CURRENCIES.map((c) => (
              <option value={c}>{c}</option>
            ))}
          </select>
        )}
      </Field>
      <Button
        variant="primary"
        onClick={async () => {
          const saved = await api.put<PollPayment>("/polls/payment", value);
          mutate(saved);
          setValue(toDraft(saved));
          invalidate("/polls/");
          toast(t`Payment details saved.`);
        }}
      >
        <Trans>Save payment details</Trans>
      </Button>
    </section>
  );
}
