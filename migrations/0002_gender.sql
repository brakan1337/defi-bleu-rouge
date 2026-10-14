ALTER TABLE users ADD COLUMN gender TEXT CHECK (gender IN ('homme', 'femme'));
