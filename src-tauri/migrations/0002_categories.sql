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
