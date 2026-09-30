-- Visits: employee pictures can be shown per visit (hidden by default) and employees get a custom order per visit.
-- A visit may also show no employees at all: all_employees = 0 without rows in visit_employees.
-- With all_employees = 1 the rows in visit_employees only define the order; employees without a row follow by name.

ALTER TABLE visits ADD COLUMN show_avatars INTEGER NOT NULL DEFAULT 0 CHECK (show_avatars IN (0, 1));
ALTER TABLE visit_employees ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Several visits are now shown side by side instead of rotating; these settings have no effect any more.
DELETE FROM settings WHERE key IN ('rotation_seconds', 'max_employees_per_slide');
