-- migrations/0001_reports.sql
CREATE TABLE reports (
  id          TEXT PRIMARY KEY NOT NULL,   -- crypto.randomUUID()
  received_at TEXT NOT NULL,               -- ISO 8601, UTC, the Function's clock
  locale      TEXT NOT NULL,
  page        TEXT NOT NULL,
  quote       TEXT NOT NULL CHECK (length(quote) BETWEEN 1 AND 1000),
  keys        TEXT NOT NULL,               -- JSON array of matched catalogue keys
  suggestion  TEXT NOT NULL DEFAULT '' CHECK (length(suggestion) <= 1000),
  note        TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000)
);
