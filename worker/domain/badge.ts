// Zahl am App-Icon: Was wartet auf eine Reaktion? Ungelesene @-Erwähnungen im
// Chat und offene Aushilfe-Anfragen, jeweils für die eigene Person und für
// Kinder, für die die Eltern zuständig sind. Bewusst keine normalen
// Chatnachrichten, sonst stünde dort ständig eine hohe Zahl.
import { first } from "../lib/db";
import { nowLocal } from "../lib/time";

export interface BadgeCount {
  count: number;
  mentions: number;
  requests: number;
}

/** Personen, für die ein Account Erwähnungen und Anfragen sieht (?1 Account). */
const PERSONS = `
  persons(person_id) AS (
    SELECT person_id FROM accounts WHERE id = ?1
    UNION
    SELECT g.child_id FROM guardianships g JOIN accounts a ON a.person_id = g.guardian_id WHERE a.id = ?1
  )`;

export async function badgeCount(db: D1Database, accountId: number, now = Date.now()): Promise<BadgeCount> {
  const row = await first<{ mentions: number; requests: number }>(
    db,
    `WITH ${PERSONS}
     SELECT
       (SELECT COUNT(*) FROM chat_mentions m
         WHERE m.person_id IN (SELECT person_id FROM persons)
           AND m.message_id > coalesce((SELECT r.last_read_id FROM chat_reads r WHERE r.account_id = ?1 AND r.team_id = m.team_id), 0)
           -- Erwähnungen eines Kindes zählen nur, wo Eltern eingebunden sind und nicht vom Chat abgemeldet
           -- Ohne Lesefreigabe der Eltern kann ein Kind den Chat nicht lesen, also auch nichts als gelesen markieren
           AND NOT (m.person_id = (SELECT person_id FROM accounts WHERE id = ?1)
                    AND EXISTS (SELECT 1 FROM teams t WHERE t.id = m.team_id AND t.parents_enabled = 1)
                    AND EXISTS (SELECT 1 FROM guardianships g WHERE g.child_id = m.person_id)
                    AND EXISTS (SELECT 1 FROM child_permissions cp WHERE cp.child_id = m.person_id AND cp.may_read_chat = 0))
           AND (m.person_id = (SELECT person_id FROM accounts WHERE id = ?1)
                OR (EXISTS (SELECT 1 FROM teams t WHERE t.id = m.team_id AND t.parents_enabled = 1)
                    AND NOT EXISTS (SELECT 1 FROM chat_optouts o WHERE o.account_id = ?1 AND o.team_id = m.team_id)))
       ) AS mentions,
       (SELECT COUNT(*) FROM help_requests h JOIN events e ON e.id = h.event_id
         WHERE h.status = 'open' AND h.person_id IN (SELECT person_id FROM persons)
           AND e.cancelled_at IS NULL AND e.starts_at > ?2
       ) AS requests`,
    accountId,
    nowLocal(now),
  );
  const mentions = row?.mentions ?? 0;
  const requests = row?.requests ?? 0;
  return { count: mentions + requests, mentions, requests };
}
