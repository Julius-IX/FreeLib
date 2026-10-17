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
