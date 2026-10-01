-- Layout: size of the visiting companies' logos in the visit tiles (percent; the own logo has logo_size).

ALTER TABLE layouts ADD COLUMN company_logo_size INTEGER NOT NULL DEFAULT 100;
