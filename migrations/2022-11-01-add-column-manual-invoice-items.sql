ALTER TABLE
    former22_manual_invoice
ADD
    COLUMN items JSON COMMENT 'invoice items';

ALTER TABLE
    former22_manual_invoice MODIFY COLUMN uuid varchar(255) UNIQUE;