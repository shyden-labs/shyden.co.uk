-- migrations/0002_report_counts.sql (#872)
-- One row per UTC day per counter. Every report deletes the rows of any
-- other day, so nothing here outlives the day it counts.
CREATE TABLE report_counts (
  day     TEXT NOT NULL,                     -- UTC date, YYYY-MM-DD
  counter TEXT NOT NULL,                     -- 'all', or HMAC-SHA-256(secret, day + ' ' + connection), 64 hex: never an IP
  count   INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (day, counter)
);
