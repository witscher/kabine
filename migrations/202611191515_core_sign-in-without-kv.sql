-- No KV write for requests without a login (docs/dev/security.md, rule 19): KV allows about 1,000 writes a day for
-- the whole account on the free plan, so anonymous requests could use them up and break the maintenance switch and
-- everything else that writes KV.

-- Passkey sign-in: the challenge is stateless (MAC in the challenge ID); after a valid signature it is booked here
-- until it expires, so the same assertion cannot be used twice. The hourly clean-up removes expired rows.
CREATE TABLE webauthn_used_challenges (
  challenge  TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
) WITHOUT ROWID;

-- Sign-in codes: the limit per network address counts here, in the statement that creates the code, instead of a
-- counter in KV. A keyed hash of the address (IPv6: its /64 prefix); the hourly clean-up empties it after an hour.
ALTER TABLE email_codes ADD COLUMN ip_hash TEXT;
CREATE INDEX email_codes_ip ON email_codes (ip_hash, created_at) WHERE ip_hash IS NOT NULL;
