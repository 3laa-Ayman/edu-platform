-- =====================================================================
-- Edu Platform — PostgreSQL schema (idempotent: safe to run repeatedly)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1) Users / Auth
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_code_counters (
  year        INT PRIMARY KEY,
  last_value  INT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  student_code   VARCHAR(20) UNIQUE,                 -- STU-2026-0001 (NULL for admins)
  full_name      VARCHAR(120) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,       -- stored lower-cased
  password_hash  VARCHAR(100),                       -- bcrypt; NULL until the student sets it after OTP
  phone          VARCHAR(20)  NOT NULL,
  parent_phone   VARCHAR(20)  NOT NULL,
  parent_email   VARCHAR(255),
  role           VARCHAR(10)  NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  is_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  token_version  INT NOT NULL DEFAULT 0,             -- bump to revoke all JWTs
  ai_spent_egp   NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (ai_spent_egp >= 0),
  ai_limit_egp   NUMERIC(10,2) NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registration flow: details → email OTP → set password → student code. Existing DBs: allow NULL until then.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS otp_codes (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      VARCHAR(20) NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash    CHAR(64) NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_user_purpose ON otp_codes (user_id, purpose, created_at DESC);

-- ---------------------------------------------------------------------
-- 2) Question bank
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
  id           SERIAL PRIMARY KEY,
  subject_id   INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  lesson_type  VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_id, name)
);

CREATE TABLE IF NOT EXISTS question_uploads (
  id           BIGSERIAL PRIMARY KEY,
  admin_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  filename     VARCHAR(255),
  total_rows   INT NOT NULL DEFAULT 0,
  inserted     INT NOT NULL DEFAULT 0,
  duplicates   INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  errors       JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id              BIGSERIAL PRIMARY KEY,
  subject_id      INT NOT NULL REFERENCES subjects(id),
  lesson_id       INT REFERENCES lessons(id) ON DELETE SET NULL,
  question_text   TEXT NOT NULL,
  option_a        TEXT NOT NULL,
  option_b        TEXT NOT NULL,
  option_c        TEXT NOT NULL,
  option_d        TEXT NOT NULL,
  correct_option  CHAR(1) NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  explanation     TEXT,                              -- free saved explanation
  law_note        TEXT,                              -- القانون / الملحوظة
  lesson_type     VARCHAR(100),
  category        VARCHAR(20) NOT NULL DEFAULT 'lesson' CHECK (category IN ('lesson', 'past_exam')),
  exam_year       SMALLINT,
  content_hash    CHAR(64) NOT NULL UNIQUE,          -- de-duplication on upload
  upload_id       BIGINT REFERENCES question_uploads(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_filters ON questions (subject_id, lesson_id, category) WHERE is_active;

-- ---------------------------------------------------------------------
-- 3) Attempts + Mistakes bank
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempts (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id           BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option       CHAR(1) CHECK (selected_option IN ('A', 'B', 'C', 'D')),  -- NULL = unanswered
  is_correct            BOOLEAN NOT NULL,
  source                VARCHAR(20) NOT NULL CHECK (source IN ('practice', 'mistakes_retry', 'competition')),
  competition_entry_id  BIGINT,
  time_spent_ms         INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_time ON attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_user_question ON attempts (user_id, question_id);

CREATE TABLE IF NOT EXISTS mistakes (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id           BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  subject_id            INT NOT NULL REFERENCES subjects(id),
  lesson_id             INT REFERENCES lessons(id) ON DELETE SET NULL,
  wrong_count           INT NOT NULL DEFAULT 1,
  last_selected_option  CHAR(1),
  first_wrong_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_wrong_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_mistakes_user_subject ON mistakes (user_id, subject_id, lesson_id);

-- ---------------------------------------------------------------------
-- 4) AI (Gemini) usage + cost tracking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_explanations (           -- generated once, served free afterwards
  question_id  BIGINT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  model        VARCHAR(60) NOT NULL,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id    BIGINT REFERENCES questions(id) ON DELETE SET NULL,
  model          VARCHAR(60) NOT NULL,
  input_tokens   INT NOT NULL DEFAULT 0,
  output_tokens  INT NOT NULL DEFAULT 0,
  total_tokens   INT NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(14,8) NOT NULL DEFAULT 0,
  cost_egp       NUMERIC(12,6) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL CHECK (status IN ('success', 'blocked', 'error')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_logs (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5) Plans / Payments / Subscriptions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  code           VARCHAR(20) PRIMARY KEY,
  name_ar        VARCHAR(60) NOT NULL,
  price_egp      NUMERIC(10,2) NOT NULL,
  duration_days  INT NOT NULL DEFAULT 30,
  rank           INT NOT NULL DEFAULT 1,              -- higher = better plan
  features       JSONB NOT NULL DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Initial plans only: once created they are managed from the admin dashboard (never overwritten here).
INSERT INTO plans (code, name_ar, price_egp, duration_days, rank, features) VALUES
  ('standard', 'Plus', 99, 30, 1,
     '{"practice": true, "mistakes_bank": true, "ai_explanations": true, "competitions": true, "parent_reports": true, "past_exams": true}'),
  ('premium',  'Premium',   199, 30, 2,
     '{"practice": true, "mistakes_bank": true, "ai_explanations": true, "competitions": true, "parent_reports": true, "past_exams": true, "priority_support": true}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS payments (
  id               BIGSERIAL PRIMARY KEY,
  reference        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),   -- merchant reference sent to gateways
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code        VARCHAR(20) NOT NULL REFERENCES plans(code),
  amount_egp       NUMERIC(10,2) NOT NULL,
  provider         VARCHAR(20) NOT NULL CHECK (provider IN ('paymob', 'fawry', 'vodafone_cash', 'instapay')),
  method_type      VARCHAR(10) NOT NULL CHECK (method_type IN ('gateway', 'manual')),
  status           VARCHAR(15) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'under_review', 'paid', 'failed', 'rejected')),
  provider_txn_id  VARCHAR(120),
  receipt_path     TEXT,                         -- legacy: receipt file on local disk
  receipt_data     BYTEA,                        -- manual: uploaded receipt (stored in DB — works on serverless/ephemeral disks)
  receipt_mime     VARCHAR(50),
  sender_account   VARCHAR(60),                  -- manual: wallet number / InstaPay address
  transfer_ref     VARCHAR(120),                 -- manual: transaction number shown on receipt
  admin_note       TEXT,
  reviewed_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_data BYTEA;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_mime VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_txn ON payments (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status, created_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code   VARCHAR(20) NOT NULL REFERENCES plans(code),
  payment_id  BIGINT UNIQUE REFERENCES payments(id) ON DELETE SET NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id, ends_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (             -- audit trail for every gateway callback
  id               BIGSERIAL PRIMARY KEY,
  provider         VARCHAR(20) NOT NULL,
  signature_valid  BOOLEAN NOT NULL,
  payment_ref      VARCHAR(120),
  result           VARCHAR(40),
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6) Teams & Competitions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id                 BIGSERIAL PRIMARY KEY,
  name               VARCHAR(80) NOT NULL,
  captain_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  is_auto_generated  BOOLEAN NOT NULL DEFAULT FALSE,
  allow_auto_fill    BOOLEAN NOT NULL DEFAULT TRUE,   -- let the system complete the team to 4
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,  -- one team per student
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_invites (
  id            BIGSERIAL PRIMARY KEY,
  team_id       BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  inviter_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_invites_pending ON team_invites (team_id, invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_team_invites_invitee ON team_invites (invitee_id, status);

CREATE TABLE IF NOT EXISTS competitions (
  id                BIGSERIAL PRIMARY KEY,
  title             VARCHAR(150) NOT NULL,
  type              VARCHAR(20) NOT NULL CHECK (type IN ('team_weekly', 'individual_monthly')),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  duration_minutes  INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS competition_questions (
  competition_id  BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  question_id     BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY (competition_id, question_id)
);

CREATE TABLE IF NOT EXISTS competition_entries (
  id                BIGSERIAL PRIMARY KEY,
  competition_id    BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id           BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  question_order    JSONB NOT NULL,      -- [{ "qid": 12, "perm": ["C","A","D","B"] }] per-student shuffle
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at       TIMESTAMPTZ NOT NULL,
  submitted_at      TIMESTAMPTZ,
  score             INT,
  total_questions   INT NOT NULL,
  duration_seconds  INT,
  UNIQUE (competition_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_leaderboard ON competition_entries (competition_id, score DESC, duration_seconds ASC);

CREATE TABLE IF NOT EXISTS competition_answers (
  entry_id         BIGINT NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  question_id      BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option  CHAR(1),            -- ORIGINAL letter (after un-shuffling)
  is_correct       BOOLEAN NOT NULL,
  PRIMARY KEY (entry_id, question_id)
);

-- ---------------------------------------------------------------------
-- 7) Study planner, parent reports, products
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_tasks (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  notes             TEXT,
  subject_id        INT REFERENCES subjects(id) ON DELETE SET NULL,
  task_date         DATE NOT NULL,
  start_time        TIME,
  duration_minutes  INT CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 720),
  priority          VARCHAR(6) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  is_done           BOOLEAN NOT NULL DEFAULT FALSE,
  done_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_study_tasks_user_date ON study_tasks (user_id, task_date);

CREATE TABLE IF NOT EXISTS parent_reports (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  summary       JSONB NOT NULL,
  channel       VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms', 'log')),
  status        VARCHAR(10) NOT NULL CHECK (status IN ('sent', 'failed')),
  error         TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parent_reports_user ON parent_reports (user_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id                BIGSERIAL PRIMARY KEY,
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  image_url         TEXT,
  category          VARCHAR(60),
  original_price    NUMERIC(10,2) NOT NULL CHECK (original_price >= 0),
  discount_percent  INT NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  final_price       NUMERIC(10,2) GENERATED ALWAYS AS (ROUND(original_price * (100 - discount_percent) / 100.0, 2)) STORED,
  coupon_code       VARCHAR(40),
  external_url      TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8) Platform settings (editable by admins from the dashboard)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         VARCHAR(60) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 9) Question images (question / each option / explanation)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_media (
  question_id  BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  slot         VARCHAR(12) NOT NULL CHECK (slot IN ('question', 'option_a', 'option_b', 'option_c', 'option_d', 'explanation')),
  mime         VARCHAR(30) NOT NULL,
  data         BYTEA NOT NULL,
  hash         CHAR(64) NOT NULL,          -- sha256 of the bytes; part of the image URL (cache-busting + unguessable)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, slot)
);

-- Skipped questions are no longer mistakes: remove bank entries that were created ONLY by an unanswered
-- competition question (never actually answered wrong), and stop counting old unanswered attempts.
DELETE FROM mistakes WHERE last_selected_option IS NULL AND wrong_count = 1;
DELETE FROM attempts WHERE selected_option IS NULL;

-- Competition answers autosaved on the server while solving (displayed labels), used for auto-submit.
ALTER TABLE competition_entries ADD COLUMN IF NOT EXISTS draft_answers JSONB NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------
-- 10) Rate-limit counters shared by all server instances (serverless-safe)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key       VARCHAR(200) PRIMARY KEY,
  hits      INT NOT NULL,
  reset_at  TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------
-- 11) Announcements from the admins to the students
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id          BIGSERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  tone        VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning')),
  audience    VARCHAR(14) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'subscribers', 'free')),
  link_url    TEXT,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_live ON announcements (starts_at DESC) WHERE is_active;

-- Who already read (dismissed) which announcement.
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id  BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

-- Mock AI explanations (no GEMINI_API_KEY) used to be cached as if real, hiding the AI button for everyone: remove them.
DELETE FROM ai_explanations WHERE content LIKE '[شرح تجريبي%';
