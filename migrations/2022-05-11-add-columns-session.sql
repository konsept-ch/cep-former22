ALTER TABLE
    former22_session
ADD
    COLUMN sessionFormat TEXT COMMENT 'The format of the session',
ADD
    COLUMN sessionLocation TEXT COMMENT 'The location of the session';