ALTER TABLE
    former22_invoice
MODIFY
    COLUMN createdAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'The date of last modification';