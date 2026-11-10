-- A personal link created by an admin can also remove the e-mail address of the access when it is used
-- (an address that may not be the person's own). See docs/dev/security.md, rule 3.
ALTER TABLE invites ADD COLUMN clear_email INTEGER NOT NULL DEFAULT 0 CHECK (clear_email IN (0, 1));
