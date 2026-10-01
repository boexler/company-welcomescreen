-- Layout: optional background video. The column holds the file name in <data dir>/media; the background image
-- stays as the fallback while the video loads or cannot be played.

ALTER TABLE layouts ADD COLUMN background_video TEXT;
