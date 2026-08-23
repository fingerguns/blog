-- Tags for Sharing links (linklog), backing the tag filter dropdown on /sharing/.
-- Run once:
--   wrangler d1 execute rommy-blog-db --file=migrate-linklog-tags.sql --remote

ALTER TABLE linklog ADD COLUMN tags TEXT;

UPDATE linklog SET tags = 'lifestyle' WHERE id = 1;
UPDATE linklog SET tags = 'architecture' WHERE id = 2;
UPDATE linklog SET tags = 'blogging' WHERE id = 3;
UPDATE linklog SET tags = 'art' WHERE id = 4;
UPDATE linklog SET tags = 'architecture' WHERE id = 5;
UPDATE linklog SET tags = 'books' WHERE id = 6;
UPDATE linklog SET tags = 'books' WHERE id = 7;
UPDATE linklog SET tags = 'film' WHERE id = 8;
UPDATE linklog SET tags = 'film' WHERE id = 9;
UPDATE linklog SET tags = 'film' WHERE id = 10;
UPDATE linklog SET tags = 'art' WHERE id = 11;
UPDATE linklog SET tags = 'blogging' WHERE id = 12;
UPDATE linklog SET tags = 'photography sports' WHERE id = 13;
UPDATE linklog SET tags = 'food' WHERE id = 14;
UPDATE linklog SET tags = 'sports' WHERE id = 15;
UPDATE linklog SET tags = 'art' WHERE id = 16;
UPDATE linklog SET tags = 'art' WHERE id = 17;
UPDATE linklog SET tags = 'art' WHERE id = 18;
UPDATE linklog SET tags = 'history' WHERE id = 19;
UPDATE linklog SET tags = 'politics' WHERE id = 20;
UPDATE linklog SET tags = 'books' WHERE id = 21;
UPDATE linklog SET tags = 'outdoors' WHERE id = 22;
UPDATE linklog SET tags = 'politics tech' WHERE id = 23;
UPDATE linklog SET tags = 'history food' WHERE id = 24;
UPDATE linklog SET tags = 'science' WHERE id = 25;
UPDATE linklog SET tags = 'society' WHERE id = 26;
UPDATE linklog SET tags = 'art' WHERE id = 27;
UPDATE linklog SET tags = 'food' WHERE id = 28;
UPDATE linklog SET tags = 'science' WHERE id = 29;
UPDATE linklog SET tags = 'art architecture' WHERE id = 30;
UPDATE linklog SET tags = 'society' WHERE id = 31;
UPDATE linklog SET tags = 'architecture' WHERE id = 32;
UPDATE linklog SET tags = 'food' WHERE id = 33;
UPDATE linklog SET tags = 'politics' WHERE id = 34;
UPDATE linklog SET tags = 'architecture' WHERE id = 35;
UPDATE linklog SET tags = 'art architecture' WHERE id = 36;
UPDATE linklog SET tags = 'art' WHERE id = 37;
UPDATE linklog SET tags = 'outdoors' WHERE id = 38;
UPDATE linklog SET tags = 'architecture' WHERE id = 39;
UPDATE linklog SET tags = 'politics' WHERE id = 40;
UPDATE linklog SET tags = 'politics' WHERE id = 41;
UPDATE linklog SET tags = 'food' WHERE id = 42;
UPDATE linklog SET tags = 'food' WHERE id = 43;
UPDATE linklog SET tags = 'tech' WHERE id = 44;
UPDATE linklog SET tags = 'art' WHERE id = 45;
UPDATE linklog SET tags = 'food' WHERE id = 46;
UPDATE linklog SET tags = 'science' WHERE id = 47;
UPDATE linklog SET tags = 'food' WHERE id = 48;
UPDATE linklog SET tags = 'art books' WHERE id = 49;
UPDATE linklog SET tags = 'art books' WHERE id = 50;
UPDATE linklog SET tags = 'food' WHERE id = 51;
