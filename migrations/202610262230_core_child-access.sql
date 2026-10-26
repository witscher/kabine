-- Children in the app (worker/domain/child-limits.ts): what players of a youth age class may do themselves.
-- Three levels, each only restricts: the age class (admins), the team (coaches, NULL = as the age class),
-- the parents' permissions per child (child_permissions). Adult classes and groups are never limited.
-- Defaults allow everything, so nothing changes for a club until an admin or coach restricts it.
ALTER TABLE age_classes ADD COLUMN child_account INTEGER NOT NULL DEFAULT 1 CHECK (child_account IN (0, 1));
ALTER TABLE age_classes ADD COLUMN child_respond INTEGER NOT NULL DEFAULT 1 CHECK (child_respond IN (0, 1));
ALTER TABLE age_classes ADD COLUMN child_chat TEXT NOT NULL DEFAULT 'write' CHECK (child_chat IN ('none', 'read', 'write'));
ALTER TABLE age_classes ADD COLUMN child_help INTEGER NOT NULL DEFAULT 1 CHECK (child_help IN (0, 1));

ALTER TABLE teams ADD COLUMN child_account INTEGER CHECK (child_account IS NULL OR child_account IN (0, 1));
ALTER TABLE teams ADD COLUMN child_respond INTEGER CHECK (child_respond IS NULL OR child_respond IN (0, 1));
ALTER TABLE teams ADD COLUMN child_chat TEXT CHECK (child_chat IS NULL OR child_chat IN ('none', 'read', 'write'));
ALTER TABLE teams ADD COLUMN child_help INTEGER CHECK (child_help IS NULL OR child_help IN (0, 1));
