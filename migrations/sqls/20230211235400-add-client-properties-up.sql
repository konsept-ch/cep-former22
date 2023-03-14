ALTER TABLE
    former22_manual_invoice
ADD COLUMN customClientTitle TEXT COMMENT 'title of client',
ADD COLUMN customClientFirstname TEXT COMMENT 'firstname of client',
ADD COLUMN customClientLastname TEXT COMMENT 'lastname of client';
