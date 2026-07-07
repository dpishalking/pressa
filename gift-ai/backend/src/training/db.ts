import { getDb } from "../db/client.js";
import { logger } from "../logger.js";

const TRAINING_SCHEMA = `
CREATE TABLE IF NOT EXISTS training_users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'employee',
  team_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_users_telegram ON training_users(telegram_id);

CREATE TABLE IF NOT EXISTS training_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manager_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'mode_a',
  difficulty TEXT NOT NULL DEFAULT 'basic',
  training_skill TEXT NOT NULL DEFAULT 'qualification',
  buyer_profile_json TEXT NOT NULL DEFAULT '{}',
  recipient_profile_json TEXT NOT NULL DEFAULT '{}',
  occasion TEXT NOT NULL DEFAULT '',
  initial_message TEXT NOT NULL,
  hidden_facts_json TEXT NOT NULL DEFAULT '[]',
  facts_available_initially_json TEXT NOT NULL DEFAULT '[]',
  primary_objection_json TEXT NOT NULL DEFAULT '{}',
  secondary_objections_json TEXT NOT NULL DEFAULT '[]',
  purchase_conditions_json TEXT NOT NULL DEFAULT '[]',
  failure_conditions_json TEXT NOT NULL DEFAULT '[]',
  initial_client_state_json TEXT NOT NULL DEFAULT '{}',
  state_thresholds_json TEXT NOT NULL DEFAULT '{}',
  ideal_dialogue_stages_json TEXT NOT NULL DEFAULT '[]',
  scoring_overrides_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL DEFAULT 'manual',
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_scenarios_difficulty ON training_scenarios(difficulty);
CREATE INDEX IF NOT EXISTS idx_training_scenarios_skill ON training_scenarios(training_skill);
CREATE INDEX IF NOT EXISTS idx_training_scenarios_published ON training_scenarios(is_published);

CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES training_users(id),
  scenario_id TEXT NOT NULL REFERENCES training_scenarios(id),
  mode TEXT NOT NULL DEFAULT 'mode_a',
  status TEXT NOT NULL DEFAULT 'active',
  score INTEGER,
  client_state_json TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  hints_used INTEGER NOT NULL DEFAULT 0,
  hint_mode INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_user ON training_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_training_sessions_status ON training_sessions(status);
CREATE INDEX IF NOT EXISTS idx_training_sessions_scenario ON training_sessions(scenario_id);

CREATE TABLE IF NOT EXISTS training_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES training_sessions(id),
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  classified_actions_json TEXT,
  state_before_json TEXT,
  state_after_json TEXT,
  state_changes_json TEXT,
  turn_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_messages_session ON training_messages(session_id);

CREATE TABLE IF NOT EXISTS training_evaluations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES training_sessions(id),
  total_score INTEGER NOT NULL DEFAULT 0,
  category_scores_json TEXT NOT NULL DEFAULT '{}',
  strengths_json TEXT NOT NULL DEFAULT '[]',
  mistakes_json TEXT NOT NULL DEFAULT '[]',
  missed_questions_json TEXT NOT NULL DEFAULT '[]',
  client_emotions_json TEXT NOT NULL DEFAULT '[]',
  turning_points_json TEXT NOT NULL DEFAULT '[]',
  state_changes_json TEXT NOT NULL DEFAULT '[]',
  better_replies_json TEXT NOT NULL DEFAULT '[]',
  final_result TEXT NOT NULL DEFAULT 'incomplete',
  client_feeling TEXT,
  example_next_message TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES training_users(id),
  skill TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, skill)
);

CREATE INDEX IF NOT EXISTS idx_skill_scores_user ON skill_scores(user_id);

CREATE TABLE IF NOT EXISTS training_assignments (
  id TEXT PRIMARY KEY,
  assigned_by TEXT NOT NULL,
  assigned_to_user_id TEXT,
  assigned_to_team_id TEXT,
  scenario_id TEXT NOT NULL REFERENCES training_scenarios(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_assignments_user ON training_assignments(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_training_assignments_team ON training_assignments(assigned_to_team_id);
CREATE INDEX IF NOT EXISTS idx_training_assignments_status ON training_assignments(status);

CREATE TABLE IF NOT EXISTS training_invites (
  token TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES training_teams(id),
  preset_full_name TEXT,
  service_tag TEXT NOT NULL DEFAULT 'retro-pressa',
  created_by_user_id TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_invites_team ON training_invites(team_id);

CREATE TABLE IF NOT EXISTS training_managers (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  service_tag TEXT NOT NULL DEFAULT 'retro-pressa',
  invite_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_managers_external ON training_managers(external_id);

CREATE TABLE IF NOT EXISTS training_session_feedback (
  session_id TEXT PRIMARY KEY REFERENCES training_sessions(id),
  user_id TEXT NOT NULL REFERENCES training_users(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_session_feedback_user ON training_session_feedback(user_id);
`;

export function initTrainingDb(): void {
  const db = getDb();
  try {
    db.exec(TRAINING_SCHEMA);
    for (const sql of [
      `ALTER TABLE training_teams ADD COLUMN manager_telegram_id TEXT`,
      `ALTER TABLE training_teams ADD COLUMN service_tag TEXT DEFAULT 'retro-pressa'`,
      `ALTER TABLE training_users ADD COLUMN service_tag TEXT`,
      `ALTER TABLE training_users ADD COLUMN lms_external_id TEXT`,
    ]) {
      try { db.exec(sql); } catch { /* column exists */ }
    }
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_training_users_lms_external ON training_users(lms_external_id)`);
    } catch { /* column missing on very old DB */ }
    logger.info("Training DB tables initialized");
  } catch (e) {
    logger.error("Failed to init training DB", { error: String(e) });
    throw e;
  }
}
