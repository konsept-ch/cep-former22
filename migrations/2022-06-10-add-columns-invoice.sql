ALTER TABLE
    former22_invoice
ADD
    COLUMN createdAt DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'The date and time of the creation of the invoice',
ADD
    COLUMN seances TEXT COMMENT 'Session events',
ADD
    COLUMN inscriptionStatus TEXT COMMENT 'The status of the inscription';