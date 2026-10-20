-- A French author's work belongs to world literature, regardless of narration language.
ALTER TABLE seasons DROP CONSTRAINT seasons_subject_check;
ALTER TABLE seasons ADD CONSTRAINT seasons_subject_check CHECK (subject IN
 ('kz-history','world-history','kz-literature','ru-literature','world-literature','algebra','geometry'));
