CREATE TABLE IF NOT EXISTS universities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  move_on_name TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (country_code IN ('CN','JP','KR','TW')),
  city TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  website TEXT NOT NULL,
  catalog_url TEXT,
  credit_system TEXT NOT NULL CHECK (credit_system IN ('ECTS','local')),
  contact_hours_per_credit REAL,
  terms_json TEXT NOT NULL,
  restrictions TEXT,
  exchange_contact TEXT,
  catalog_public INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  university_id TEXT NOT NULL REFERENCES universities(id),
  kind TEXT NOT NULL CHECK (kind IN ('html','pdf','manual')),
  url TEXT NOT NULL,
  reader TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT
);

CREATE TABLE IF NOT EXISTS host_courses (
  id INTEGER PRIMARY KEY,
  university_id TEXT NOT NULL REFERENCES universities(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  outline TEXT,
  credits REAL,
  contact_hours REAL,
  language TEXT NOT NULL CHECK (language IN ('en','other','unknown')),
  terms_json TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('undergrad','grad')),
  source_url TEXT NOT NULL,
  snapshot_id INTEGER REFERENCES snapshots(id),
  collected_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (university_id, code)
);

CREATE TABLE IF NOT EXISTS poly_courses (
  sigle TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  credits REAL NOT NULL,
  triplet_json TEXT NOT NULL,
  prerequisites TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('obligatoire','optionnel')),
  eligible INTEGER NOT NULL,
  ineligible_reason TEXT,
  compared INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  courses_found INTEGER NOT NULL,
  previous_count INTEGER,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  modified INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT
);

CREATE TABLE IF NOT EXISTS criterion_versions (
  version INTEGER PRIMARY KEY,
  params_hash TEXT NOT NULL,
  params_json TEXT NOT NULL,
  frozen_at TEXT
);

CREATE TABLE IF NOT EXISTS embeddings (
  model_key TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('notion','passage')),
  vector BLOB NOT NULL,
  PRIMARY KEY (model_key, text_sha256, kind)
);

CREATE TABLE IF NOT EXISTS matches (
  poly_sigle TEXT NOT NULL REFERENCES poly_courses(sigle),
  host_course_id INTEGER NOT NULL REFERENCES host_courses(id),
  criterion_version INTEGER NOT NULL REFERENCES criterion_versions(version),
  notions_found TEXT NOT NULL,
  notions_missing TEXT NOT NULL,
  notion_sims TEXT NOT NULL,
  content_score REAL NOT NULL,
  content_band TEXT NOT NULL CHECK (content_band IN ('tres','partiel','aucun')),
  workload TEXT NOT NULL CHECK (workload IN ('conforme','trop_legere','trop_lourde','inconnue')),
  level TEXT CHECK (level IN ('elevee','moyenne','faible')),
  text_used TEXT NOT NULL,
  PRIMARY KEY (poly_sigle, host_course_id, criterion_version)
);
