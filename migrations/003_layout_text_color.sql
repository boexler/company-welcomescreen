-- Text color per layout (for bright background images dark text reads better). Existing layouts keep white.

ALTER TABLE layouts ADD COLUMN text_color TEXT NOT NULL DEFAULT '#ffffff';
