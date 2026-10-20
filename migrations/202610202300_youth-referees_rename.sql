-- "KiHaSL/JuHaSL" becomes "Jugendschiedsrichter" (youth referees): the duty type and the automatic group, where
-- the club kept the name Kabine gave them; the group only if the new name is free (team names are unique).
-- Names the club chose stay. Only renames, so the previous release keeps working.
UPDATE duty_types SET name = 'Jugendschiedsrichter' WHERE code = 'referee' AND name = 'KiHaSL/JuHaSL';
UPDATE teams SET name = 'Jugendschiedsrichter'
 WHERE kind = 'group' AND auto_members = 'referees' AND name = 'KiHaSL/JuHaSL'
   AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.name = 'Jugendschiedsrichter');
