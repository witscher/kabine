-- Coaches see the coach notes of release notes after an update (worker/domain/news.ts). Until now only admins
-- had a mark of the last version they saw; an account without one starts with everything seen. Accounts that
-- exist before this update count as having seen 0.6.0, the release before the first coach notes, so existing
-- coaches see what is new for them. New accounts and new installations stay without a backlog.
UPDATE accounts SET changelog_seen = '0.6.0' WHERE changelog_seen IS NULL;
