export type SavedAnswer = {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  correct: number;
  explanation: string;
  passed: boolean;
  episode_id: string | null;
  episode_position: number | null;
  episode_title: string | null;
};
export type ResultRow = {
  class_id: string;
  class_name: string;
  user_id: string;
  name: string;
  season_id: string;
  title: string;
  due_at: string;
  episode_count: number;
  watched: number;
  micro_correct: number;
  micro_answered: number;
  test_score: number | null;
  latest_score: number | null;
  previous_score: number | null;
  latest_attempt_id: string | null;
  latest_at: string | null;
  retelling_id: string | null;
  teacher_score: number | null;
  feedback: string | null;
  transcript: string | null;
  retelling_at: string | null;
};
export type ReportFocus = 'all' | 'help' | 'review' | 'not_started' | 'awaiting_test';
export type CommonMistake = SavedAnswer & {
  key: string;
  season_id: string;
  title: string;
  wrong: number;
  answered: number;
};
export type ReportOverview = {
  rows: ResultRow[];
  counts: { learners: number; help: number; review: number };
  coverage: { available: number; total: number };
  mistakes: CommonMistake[];
  options: {
    class_id: string;
    class_name: string;
    season_id: string | null;
    title: string | null;
  }[];
};
export type TeacherAttempt = {
  id: string;
  name: string;
  class_name: string;
  title: string;
  season_id: string;
  score: number;
  total: number;
  created_at: string;
  kind: 'legacy' | 'final';
  snapshot_source: 'captured' | 'reconstructed' | 'unavailable';
  results: SavedAnswer[];
};
