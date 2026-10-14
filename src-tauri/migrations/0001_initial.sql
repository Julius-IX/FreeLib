PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE author (
    author_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    birth_date DATE CHECK (birth_date IS NULL OR date(birth_date) = birth_date),
    death_date DATE CHECK (death_date IS NULL OR date(death_date) = death_date),
    CHECK (birth_date IS NULL OR death_date IS NULL OR death_date >= birth_date)
);

CREATE TABLE series (
    series_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Cover path is derived from the book's ISBN
CREATE TABLE book (
    book_id INTEGER NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    isbn TEXT UNIQUE,
    publish_date DATE CHECK (
        publish_date IS NULL OR date(publish_date) = publish_date
    ),
    blurb TEXT,
    page_count INTEGER CHECK (page_count > 0),
    series_id INTEGER REFERENCES series (series_id),
    series_position REAL    -- REAL allows 1.5 novellas
);

CREATE TABLE book_author (
    book_id INTEGER NOT NULL REFERENCES book (book_id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES author (author_id),
    PRIMARY KEY (book_id, author_id)
);

CREATE TABLE tag_type (
    tag_type_id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE  -- 'theme', 'genre', 'misc'
);

CREATE TABLE tag (
    tag_id INTEGER NOT NULL PRIMARY KEY,
    tag_type_id INTEGER NOT NULL REFERENCES tag_type (tag_type_id),
    name TEXT NOT NULL,
    UNIQUE (tag_type_id, name)
);

CREATE TABLE book_tag (
    book_id INTEGER NOT NULL REFERENCES book (book_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag (tag_id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, tag_id)
);

-- One row per read-through, so rereads work
CREATE TABLE reading (
    reading_id INTEGER NOT NULL PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES book (book_id) ON DELETE CASCADE,
    date_started DATE CHECK (
        date_started IS NULL OR date(date_started) = date_started
    ),
    date_finished DATE CHECK (
        date_finished IS NULL OR date(date_finished) = date_finished
    ),
    CHECK (
        date_finished IS NULL
        OR date_started IS NULL
        OR date_finished >= date_started
    )
);

CREATE INDEX idx_book_series ON book (series_id);
CREATE INDEX idx_book_author ON book_author (author_id);
CREATE INDEX idx_book_tag ON book_tag (tag_id);
CREATE INDEX idx_reading_book ON reading (book_id);

INSERT INTO tag_type (name) VALUES ('theme'), ('genre'), ('misc');
