-- Freeze each account's daily selection across reloads, devices and server restarts.
CREATE TABLE daily_sessions (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_date date NOT NULL,
 mode text NOT NULL CHECK (mode IN ('school','free')),
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 episode_ids uuid[] NOT NULL CHECK (cardinality(episode_ids) BETWEEN 1 AND 3),
 context_key text NOT NULL,
 topic_source text NOT NULL CHECK (topic_source IN ('class','assignment','personal','review','library')),
 class_name text,
 is_review boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, session_date, mode)
);
CREATE INDEX daily_sessions_season ON daily_sessions(season_id);
CREATE INDEX micro_answers_passed_episode ON micro_answers(user_id,episode_id) WHERE passed;
CREATE INDEX memberships_student ON memberships(user_id,class_id);
