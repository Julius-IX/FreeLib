CREATE TABLE category (
    category_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL CHECK (
        color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'
    )
);

CREATE TABLE book_category (
    book_id INTEGER NOT NULL REFERENCES book (book_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES category (category_id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, category_id)
);

-- When a book was added to the library, for "order by date added".
--
-- A trigger stamps new rows, so no insert path (add form, scan, backup import) has to remember
-- to set it. Books that already exist are stamped with the time of this migration: their real add
-- date is unknown, and sorting breaks the tie with book_id, which keeps their insertion order.
-- (SQLite can't add a column with a non-constant default, hence '' + trigger.)
ALTER TABLE book ADD COLUMN added_at TEXT NOT NULL DEFAULT '';

UPDATE book SET added_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

CREATE TRIGGER book_added_at AFTER INSERT ON book
WHEN NEW.added_at = ''
BEGIN
    UPDATE book SET added_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE book_id = NEW.book_id;
END;

-- Deleting a series takes it off every book that is in it instead of being refused.
--
-- book.series_id has no ON DELETE rule and SQLite can't change a foreign key without rebuilding
-- the whole table, so a trigger does it: it runs BEFORE the delete, and the foreign key is only
-- checked once the statement is done, by which point no book points at the series any more.
-- Being in the database (not in one Rust command) it also covers backup imports and anything
-- else that deletes a series.
CREATE TRIGGER series_delete_unlink
BEFORE DELETE ON series
BEGIN
    UPDATE book
    SET series_id = NULL, series_position = NULL
    WHERE series_id = OLD.series_id;
END;

-- A position only means something inside a series: a book without one never keeps its number,
-- whether the series was removed from the book, or the book was written without one.
CREATE TRIGGER book_series_position_cleared_on_insert
AFTER INSERT ON book
WHEN NEW.series_id IS NULL AND NEW.series_position IS NOT NULL
BEGIN
    UPDATE book SET series_position = NULL WHERE book_id = NEW.book_id;
END;

CREATE TRIGGER book_series_position_cleared_on_update
AFTER UPDATE OF series_id, series_position ON book
WHEN NEW.series_id IS NULL AND NEW.series_position IS NOT NULL
BEGIN
    UPDATE book SET series_position = NULL WHERE book_id = NEW.book_id;
END;

-- Books that already have a position without a series.
UPDATE book SET series_position = NULL WHERE series_id IS NULL AND series_position IS NOT NULL;
