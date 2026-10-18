-- A book's rating, on a 0-10 scale.
--
-- REAL so a half-star from a 5-star system survives (3.5 stars = 7). 0 means "not rated", the
-- same convention library imports use, so every book has a value and nothing has to special-case
-- NULL. Existing books are unrated.
ALTER TABLE book ADD COLUMN rating REAL NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 10);
