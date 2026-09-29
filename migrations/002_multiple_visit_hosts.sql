-- A visit can have several in-house contacts (hosts) instead of a single visits.host.

CREATE TABLE visit_hosts (
  visit_id    INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  PRIMARY KEY (visit_id, position)
);

-- Carry over existing contacts unchanged (one entry each).
INSERT INTO visit_hosts (visit_id, position, name)
SELECT id, 0, trim(host) FROM visits WHERE host IS NOT NULL AND trim(host) <> '';

ALTER TABLE visits DROP COLUMN host;
