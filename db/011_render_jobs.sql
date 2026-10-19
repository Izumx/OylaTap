CREATE TABLE render_jobs (
  season_id uuid PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX render_jobs_pending ON render_jobs(created_at) WHERE state='queued';
-- Preserve work started by the previous in-process implementation during an upgrade.
INSERT INTO render_jobs(season_id) SELECT id FROM seasons WHERE status='rendering';
