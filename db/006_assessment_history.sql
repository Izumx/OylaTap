ALTER TABLE questions ADD COLUMN purpose text NOT NULL DEFAULT 'micro'
 CHECK (purpose IN ('micro','final'));
ALTER TABLE attempts ADD COLUMN kind text NOT NULL DEFAULT 'legacy'
 CHECK (kind IN ('legacy','final','practice'));
ALTER TABLE attempts ALTER COLUMN kind SET DEFAULT 'final';
ALTER TABLE attempts ADD COLUMN results_snapshot jsonb;
ALTER TABLE attempts ADD COLUMN snapshot_source text NOT NULL DEFAULT 'unavailable'
 CHECK (snapshot_source IN ('captured','reconstructed','unavailable'));
ALTER TABLE attempts ADD COLUMN parent_attempt_id uuid REFERENCES attempts(id) ON DELETE SET NULL;

-- Preserve original answers, scores and dates. Only reconstruct a review when
-- current questions can reproduce the complete original result. Its origin is explicit.
WITH answer_rows AS (
 SELECT a.id,a.total,a.score,q.id question_id,q.position,q.prompt,q.options,q.correct,q.explanation,
 q.episode_id,e.position episode_position,e.title episode_title,
 CASE WHEN (a.answers->>q.position) ~ '^[0-9]{1,2}$' THEN (a.answers->>q.position)::int END answer
 FROM attempts a JOIN questions q ON q.season_id=a.season_id AND q.position<a.total
 LEFT JOIN episodes e ON e.id=q.episode_id
 WHERE CASE WHEN jsonb_typeof(a.answers)='array' THEN jsonb_array_length(a.answers) ELSE 0 END=a.total
), recovered AS (
 SELECT id,jsonb_agg(jsonb_build_object(
  'id',question_id,'prompt',prompt,'options',options,'answer',answer,'correct',correct,
  'explanation',explanation,'passed',answer=correct,'episode_id',episode_id,
  'episode_position',episode_position,'episode_title',episode_title
 ) ORDER BY position) snapshot
 FROM answer_rows GROUP BY id,total,score
 HAVING count(*)=total AND count(*) FILTER(WHERE answer=correct)=score
 AND bool_and(answer IS NOT NULL AND answer>=0 AND answer<jsonb_array_length(options))
)
UPDATE attempts a SET results_snapshot=r.snapshot,snapshot_source='reconstructed'
FROM recovered r WHERE a.id=r.id;

-- Practice never changes assessment scores. Once a learner has a separate final
-- test, its results supersede the old shared-question format in aggregates.
CREATE VIEW assessment_attempts AS
 SELECT a.* FROM attempts a WHERE a.kind='final' OR
 (a.kind='legacy' AND NOT EXISTS(SELECT 1 FROM attempts f
   WHERE f.user_id=a.user_id AND f.season_id=a.season_id AND f.kind='final'));
CREATE INDEX attempts_history ON attempts(user_id,created_at DESC,id DESC);
CREATE INDEX attempts_final_latest ON attempts(user_id,season_id,created_at DESC,id DESC) WHERE kind='final';
CREATE INDEX attempts_parent ON attempts(parent_attempt_id) WHERE parent_attempt_id IS NOT NULL;
