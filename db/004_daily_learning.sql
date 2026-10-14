ALTER TABLE users ADD COLUMN IF NOT EXISTS current_season_id uuid REFERENCES seasons(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests jsonb NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_time text NOT NULL DEFAULT '17:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_date date;
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS current_season_id uuid REFERENCES seasons(id) ON DELETE SET NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS episode_id uuid REFERENCES episodes(id) ON DELETE CASCADE;
UPDATE questions q SET episode_id=e.id FROM episodes e
WHERE q.season_id=e.season_id AND q.position=e.position AND q.episode_id IS NULL;
CREATE TABLE IF NOT EXISTS micro_answers (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
 question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 answer integer NOT NULL, passed boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS micro_answers_student ON micro_answers(user_id,created_at);
UPDATE classrooms SET current_season_id='10000000-0000-4000-8000-000000000001'
WHERE id='20000000-0000-4000-8000-000000000001';
