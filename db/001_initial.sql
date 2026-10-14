CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('student','teacher')),
 grade integer NOT NULL DEFAULT 7 CHECK (grade BETWEEN 5 AND 11),
 language text NOT NULL DEFAULT 'ru' CHECK (language IN ('ru','kk')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS classrooms (
 id uuid PRIMARY KEY, teacher_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 code text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 class_id uuid REFERENCES classrooms(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(class_id,user_id)
);
CREATE TABLE IF NOT EXISTS seasons (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
 description text NOT NULL, subject text NOT NULL CHECK (subject IN ('kz-history','world-history','kz-literature','ru-literature')),
 language text NOT NULL CHECK (language IN ('ru','kk')), grade integer NOT NULL CHECK (grade BETWEEN 5 AND 11),
 color text NOT NULL DEFAULT 'sage', art text NOT NULL DEFAULT 'history',
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','rendering','review','published','failed')),
 source_text text NOT NULL DEFAULT '', source_name text NOT NULL DEFAULT '',
 render_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS episodes (
 id uuid PRIMARY KEY, season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 position integer NOT NULL, title text NOT NULL, script text NOT NULL,
 duration integer NOT NULL DEFAULT 60, media_path text, UNIQUE(season_id,position)
);
CREATE TABLE IF NOT EXISTS questions (
 id uuid PRIMARY KEY, season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 position integer NOT NULL, prompt text NOT NULL, options jsonb NOT NULL,
 correct integer NOT NULL CHECK(correct >= 0), explanation text NOT NULL,
 UNIQUE(season_id,position)
);
CREATE TABLE IF NOT EXISTS assignments (
 id uuid PRIMARY KEY, class_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(class_id,season_id)
);
CREATE TABLE IF NOT EXISTS completions (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
 completed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,episode_id)
);
CREATE TABLE IF NOT EXISTS attempts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, answers jsonb NOT NULL,
 score integer NOT NULL, total integer NOT NULL CHECK(total > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS retellings (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 media_path text NOT NULL, mime_type text NOT NULL, transcript text NOT NULL DEFAULT '',
 teacher_score integer CHECK(teacher_score BETWEEN 0 AND 100), feedback text,
 reviewed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seasons_owner ON seasons(owner_id);
CREATE INDEX IF NOT EXISTS attempts_student_season ON attempts(user_id,season_id);
CREATE INDEX IF NOT EXISTS retellings_season ON retellings(season_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
