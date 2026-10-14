-- Le lien Strava devient facultatif : SQLite ne sait pas retirer un NOT NULL, on reconstruit la table.
PRAGMA defer_foreign_keys = true;

CREATE TABLE activities_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  team TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('course', 'marche')),
  distance_m INTEGER NOT NULL,
  activity_date TEXT NOT NULL,
  strava_url TEXT,
  strava_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'invalide')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO activities_new SELECT * FROM activities;
DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;
CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_activities_created ON activities(created_at);

PRAGMA defer_foreign_keys = false;
