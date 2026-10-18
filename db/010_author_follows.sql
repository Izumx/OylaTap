-- Concept 3.0: learners follow authors they like. One-way only: no messages or
-- contact between an adult author and a child, only a signal for the feed.
CREATE TABLE author_follows (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, author_id),
 CHECK (user_id <> author_id)
);
CREATE INDEX author_follows_author_idx ON author_follows(author_id);
