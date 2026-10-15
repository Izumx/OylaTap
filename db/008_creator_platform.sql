-- Authors outside schools, moderation before the shared feed, curriculum topics,
-- engagement signals for ranking and generated video styles.

-- Any knowledgeable person can register as an author ('creator'). Trust grows only
-- through moderated publications; moderators are a separate permission.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student','teacher','creator'));
ALTER TABLE users ADD COLUMN trust_level text NOT NULL DEFAULT 'new'
 CHECK (trust_level IN ('new','trusted'));
ALTER TABLE users ADD COLUMN is_moderator boolean NOT NULL DEFAULT false;

ALTER TABLE seasons DROP CONSTRAINT seasons_subject_check;
ALTER TABLE seasons ADD CONSTRAINT seasons_subject_check CHECK (subject IN
 ('kz-history','world-history','kz-literature','ru-literature','algebra','geometry'));
-- 'moderation': waiting for a moderator before the shared feed.
-- 'rejected': returned to the author with a note; editable like a draft.
ALTER TABLE seasons DROP CONSTRAINT seasons_status_check;
ALTER TABLE seasons ADD CONSTRAINT seasons_status_check CHECK (status IN
 ('draft','rendering','review','moderation','published','rejected','failed'));
ALTER TABLE seasons ADD COLUMN style text NOT NULL DEFAULT 'cards'
 CHECK (style IN ('cards','board','captions'));
ALTER TABLE seasons ADD COLUMN voice text NOT NULL DEFAULT 'none'
 CHECK (voice IN ('none','tts','own'));
ALTER TABLE seasons ADD COLUMN moderation_flags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE seasons ADD COLUMN moderation_note text;
-- Hidden by complaints: stays available to its assigned classes, leaves the shared feed.
ALTER TABLE seasons ADD COLUMN hidden boolean NOT NULL DEFAULT false;
ALTER TABLE seasons ADD COLUMN published_at timestamptz;
UPDATE seasons SET published_at=updated_at WHERE status='published';

-- Creator's own narration per episode; the renderer times the frames to it.
ALTER TABLE episodes ADD COLUMN voice_path text;
-- Uploaded MP4s are the author's final cut; regeneration keeps them.
ALTER TABLE episodes ADD COLUMN media_kind text NOT NULL DEFAULT 'rendered'
 CHECK (media_kind IN ('rendered','uploaded'));

-- Approximate mapping of the state school programme to grade, subject and school
-- week (1 = first week of September). Schools differ in pace; the class topic set
-- by a teacher always overrides this estimate.
CREATE TABLE curriculum_topics (
 id uuid PRIMARY KEY,
 subject text NOT NULL,
 grade integer NOT NULL CHECK (grade BETWEEN 5 AND 11),
 title_ru text NOT NULL,
 title_kk text NOT NULL,
 week_from integer NOT NULL CHECK (week_from BETWEEN 1 AND 36),
 week_to integer NOT NULL CHECK (week_to BETWEEN week_from AND 36),
 UNIQUE (subject, grade, title_ru)
);
CREATE INDEX curriculum_topics_lookup ON curriculum_topics(grade, week_from, week_to);
ALTER TABLE seasons ADD COLUMN topic_id uuid REFERENCES curriculum_topics(id) ON DELETE SET NULL;
CREATE INDEX seasons_topic ON seasons(topic_id) WHERE topic_id IS NOT NULL;

-- One row per learner and episode: the best watched share and whether it finished.
CREATE TABLE episode_views (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
 watched_ratio real NOT NULL DEFAULT 0 CHECK (watched_ratio BETWEEN 0 AND 1),
 first_at timestamptz NOT NULL DEFAULT now(),
 last_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, episode_id)
);
CREATE INDEX episode_views_episode ON episode_views(episode_id);

CREATE TABLE episode_likes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, episode_id)
);
CREATE INDEX episode_likes_episode ON episode_likes(episode_id);

CREATE TABLE content_reports (
 id uuid PRIMARY KEY,
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK (reason IN ('mistake','unsafe','spam','copyright','other')),
 comment text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (season_id, user_id)
);
CREATE INDEX content_reports_open ON content_reports(season_id) WHERE status='open';

-- Every automatic and human decision stays visible to moderators and the author.
CREATE TABLE moderation_decisions (
 id uuid PRIMARY KEY,
 season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
 moderator_id uuid REFERENCES users(id) ON DELETE SET NULL,
 decision text NOT NULL CHECK (decision IN
  ('submitted','auto_published','approved','rejected','hidden_by_reports','restored','unpublished')),
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_decisions_season ON moderation_decisions(season_id, created_at DESC);
