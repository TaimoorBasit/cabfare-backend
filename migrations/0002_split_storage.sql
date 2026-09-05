-- Migration: 0002_split_storage.sql
-- Split giant single-row database_state into logical app_sections

CREATE TABLE IF NOT EXISTS app_sections (
  section_key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Idempotent population: populate sections from existing database_state if not already present
INSERT OR IGNORE INTO app_sections (section_key, data, updated_at)
SELECT json_each.key, json_each.value, datetime('now')
FROM database_state, json_each(state)
WHERE database_state.id = 1;
