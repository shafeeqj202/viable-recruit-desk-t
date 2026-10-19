const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Refusing to start without a database.');
  process.exit(1);
}

// Render's managed Postgres requires SSL from external/internal connections in most
// plans; allow self-signed chains. Locally (no sslmode set) this is harmless.
const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('job_seq', 1) ON CONFLICT DO NOTHING;
INSERT INTO counters (name, value) VALUES ('candidate_seq', 1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  partner TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  work_rights TEXT NOT NULL DEFAULT '',
  engagement_type TEXT NOT NULL DEFAULT '',
  location_type TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  onshore_rate TEXT NOT NULL DEFAULT '',
  offshore_rate TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open',
  priority TEXT NOT NULL DEFAULT 'Medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id)
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'Medium';

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  work_rights TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT '',
  cost TEXT NOT NULL DEFAULT '',
  billing_rate TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Shortlisted',
  blacklisted BOOLEAN NOT NULL DEFAULT false,
  viable_fte BOOLEAN NOT NULL DEFAULT false,
  resume_name TEXT,
  resume_type TEXT,
  resume_size INTEGER,
  resume_data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id)
);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS viable_fte BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_candidates_job_id ON candidates(job_id);

CREATE TABLE IF NOT EXISTS candidate_status_history (
  id SERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_history_candidate_id ON candidate_status_history(candidate_id);
`;

async function initSchema() {
  await pool.query(SCHEMA_SQL);
}

async function nextSeq(name) {
  const res = await pool.query(
    `UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value`,
    [name]
  );
  return res.rows[0].value - 1; // value before increment
}

async function bumpSeqIfHigher(name, atLeast) {
  await pool.query(
    `UPDATE counters SET value = GREATEST(value, $2) WHERE name = $1`,
    [name, atLeast]
  );
}

module.exports = { pool, query, initSchema, nextSeq, bumpSeqIfHigher };
