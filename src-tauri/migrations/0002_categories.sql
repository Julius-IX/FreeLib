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
