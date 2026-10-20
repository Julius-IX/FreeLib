-- The library the filter tests run against. Built to make every filter tell books apart:
-- partial and missing dates, a reread, books with nothing filled in, LIKE wildcards in a title,
-- non-ASCII text, two categories sharing a colour, books with several authors, rated and unrated.

INSERT INTO author (author_id, name, birth_date, death_date) VALUES
  (1, 'Ursula K. Le Guin', '1929-10-21', '2018-01-22'),
  (2, 'Frank Herbert',     '1920-10-08', '1986-02-11'),
  (3, 'N. K. Jemisin',     '1972-09-19', NULL),
  (4, 'Anonymous',         NULL,         NULL),
  (5, 'Isaac Asimov',      '1920',       '1992-04');

INSERT INTO series (series_id, name) VALUES (1, 'Earthsea'), (2, 'Dune'), (3, 'Broken Earth');

-- tag types 1..3 (theme, genre, misc) come from the first migration
INSERT INTO tag (tag_id, tag_type_id, name) VALUES
  (1, 2, 'fantasy'), (2, 2, 'scifi'), (3, 3, 'classic'), (4, 1, 'dragons'), (5, 1, 'politics');

INSERT INTO category (category_id, name, color) VALUES
  (1, 'Owned',    '#ff0000'),
  (2, 'Wishlist', '#00ff00'),
  (3, 'Lent out', '#FF0000'),
  (4, 'Archive',  '#0000ff');

INSERT INTO shelf (shelf_id, name, position) VALUES (1, 'Main', 0), (2, 'Kids', 1);

INSERT INTO book (book_id, title, isbn, publish_date, blurb, page_count, series_id, series_position, notes, rating, added_at) VALUES
  (1,  'A Wizard of Earthsea',   '9780547773742', '1968-11-01', 'A young wizard learns his true name', 183, 1, 1,    '',                      9,   '2024-01-01T00:00:00.000Z'),
  (2,  'The Tombs of Atuan',     '9780689845369', '1971-01-01', NULL,                                  160, 1, 2,    'Loved the cave scenes', 8,   '2024-01-02T00:00:00.000Z'),
  (3,  'Dune',                   '9780441172719', '1965-08-01', 'Spice and sandworms',                 612, 2, 1,    '',                      10,  '2024-01-03T00:00:00.000Z'),
  (4,  'Dune Messiah',           '9780593098233', '1969-10-15', NULL,                                  331, 2, 2,    'read slowly',           0,   '2024-01-04T00:00:00.000Z'),
  (5,  'The Fifth Season',       '9780316229296', '2015-08-04', 'The world ends, again',               468, 3, 1,    '',                      7.5, '2024-01-05T00:00:00.000Z'),
  (6,  'Foundation',             NULL,            '1951-06-01', NULL,                                  255, NULL, NULL, 'Psychohistory',      8.5, '2024-01-06T00:00:00.000Z'),
  (7,  'No Details',             NULL,            NULL,         NULL,                                  NULL, NULL, NULL, '',                    0,   '2024-01-07T00:00:00.000Z'),
  (8,  'Anonymous Poems',        '',              '1900-01-01', NULL,                                  80,  NULL, NULL, '',                     0,   '2024-01-08T00:00:00.000Z'),
  (9,  'Dragon Tales',           '9781234567897', '2020-05-05', 'dragons everywhere',                  300, NULL, NULL, 'kids',                 3,   '2024-01-09T00:00:00.000Z'),
  (10, 'Space Politics',         '9781111111111', '1999-12-31', NULL,                                  1000, NULL, NULL, '',                    5,   '2024-01-10T00:00:00.000Z'),
  (11, 'Mixed Genres',           '9782222222222', '2001-01-01', NULL,                                  500, NULL, NULL, '',                     0,   '2024-01-11T00:00:00.000Z'),
  (12, '100% Wild_Card',         '9783333333333', NULL,         NULL,                                  NULL, NULL, NULL, '',                    0,   '2024-01-12T00:00:00.000Z'),
  (13, 'Ünïcode Böök',           NULL,            NULL,         NULL,                                  NULL, NULL, NULL, '',                    6,   '2024-01-13T00:00:00.000Z'),
  (14, 'Anthology of Giants',    '9784444444444', '2010-10-10', 'Three authors',                       700, NULL, NULL, '',                     0,   '2024-01-14T00:00:00.000Z');

INSERT INTO book_author (book_id, author_id) VALUES
  (1, 1), (2, 1), (3, 2), (4, 2), (5, 3), (6, 5), (8, 4), (9, 3), (10, 2), (11, 1), (11, 5),
  (14, 1), (14, 2), (14, 3);

INSERT INTO book_tag (book_id, tag_id) VALUES
  (1, 1), (1, 3), (2, 1), (3, 2), (3, 3), (4, 2), (5, 1), (6, 2), (6, 3), (9, 1), (9, 4),
  (10, 2), (10, 5), (11, 1), (11, 2), (11, 3), (14, 1), (14, 2);

INSERT INTO book_category (book_id, category_id) VALUES
  (1, 1), (2, 1), (2, 2), (3, 3), (5, 2), (6, 4), (9, 1), (9, 3), (11, 4);

INSERT INTO book_shelf (book_id, shelf_id) VALUES
  (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 2), (9, 2), (10, 2), (11, 1), (11, 2);

-- 1 was read and is being reread, 5 has no start date, 4 and 9 are in progress, the rest are unread
INSERT INTO reading (book_id, date_started, date_finished) VALUES
  (1, '2020-01-01', '2020-01-10'),
  (1, '2024-03-01', NULL),
  (2, '2021-05-01', '2021-05-09'),
  (3, '2019-02-01', '2019-02-20'),
  (4, '2024-06-01', NULL),
  (5, NULL,         '2022-12-24'),
  (6, '2023-04-01', '2023-04-30'),
  (9, '2024-07-01', NULL);
