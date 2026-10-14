CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  pseudo TEXT,
  weekly_km REAL,
  team TEXT CHECK (team IN ('bleu', 'rouge')),
  joined_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  team TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('course', 'marche')),
  distance_m INTEGER NOT NULL,
  activity_date TEXT NOT NULL,
  strava_url TEXT NOT NULL,
  strava_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'invalide')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_activities_created ON activities(created_at);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert', 'traite')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (activity_id, reporter_id)
);
