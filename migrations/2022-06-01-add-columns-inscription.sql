ALTER TABLE
    former22_inscription
ADD
    COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'The date of last modification';