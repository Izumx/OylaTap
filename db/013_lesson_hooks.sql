-- Lesson hooks: a short riddle episode a teacher sends before a lesson; students bet,
-- the class screen reveals the answer, and a recheck follows three days later.
ALTER TABLE seasons DROP CONSTRAINT seasons_subject_check;
ALTER TABLE seasons ADD CONSTRAINT seasons_subject_check CHECK (subject IN
 ('kz-history','world-history','kz-literature','ru-literature','world-literature','algebra','geometry','physics','biology','geography'));
ALTER TABLE seasons ADD COLUMN kind text NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson','hook'));
ALTER TABLE questions DROP CONSTRAINT questions_purpose_check;
ALTER TABLE questions ADD CONSTRAINT questions_purpose_check CHECK (purpose IN ('micro','final','hook'));

-- Guests join a class with a code and a name only; inactive guests are purged after 60 days.
ALTER TABLE users ADD COLUMN is_guest boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX users_stale_guests ON users(last_seen_at) WHERE is_guest;

CREATE TABLE hook_runs (
 id uuid PRIMARY KEY,
 class_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 lesson_at timestamptz NOT NULL,
 votes_shown_at timestamptz,
 revealed_at timestamptz,
 recheck_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (class_id, season_id)
);
CREATE TABLE hook_guesses (
 run_id uuid NOT NULL REFERENCES hook_runs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 phase text NOT NULL CHECK (phase IN ('before','recheck')),
 answer integer NOT NULL CHECK (answer >= 0),
 confidence integer NOT NULL DEFAULT 2 CHECK (confidence BETWEEN 1 AND 3),
 reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 140),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (run_id, user_id, phase)
);

-- Starter topics for the six demo hooks. Not an official calendar plan; a methodologist checks it.
INSERT INTO curriculum_topics(id,subject,grade,title_ru,title_kk,week_from,week_to) VALUES
 ('40000000-0000-4000-8000-000000000901','physics',7,'Взаимодействие тел. Сила','Денелердің өзара әрекеттесуі. Күш',10,16),
 ('40000000-0000-4000-8000-000000000902','biology',7,'Фотосинтез и пигменты листа','Фотосинтез және жапырақ пигменттері',8,12),
 ('40000000-0000-4000-8000-000000000903','geography',7,'Климат и его факторы','Климат және оның факторлары',12,17),
 ('40000000-0000-4000-8000-000000000904','kz-literature',8,'Абай — переводчик','Абай — аудармашы',14,17)
ON CONFLICT DO NOTHING;
