-- Layout: size of the own logo (percent), gap between the visit tiles and between the content and the dock
-- (pixels at Full HD, scaled with the screen), and fonts/sizes/colors per text element (JSON, see service.js).

ALTER TABLE layouts ADD COLUMN logo_size INTEGER NOT NULL DEFAULT 100;
ALTER TABLE layouts ADD COLUMN tile_gap INTEGER NOT NULL DEFAULT 32;
ALTER TABLE layouts ADD COLUMN footer_gap INTEGER NOT NULL DEFAULT 32;
ALTER TABLE layouts ADD COLUMN typography TEXT NOT NULL DEFAULT '{}';
