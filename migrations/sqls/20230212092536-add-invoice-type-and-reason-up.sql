ALTER TABLE
    former22_manual_invoice
ADD
    COLUMN invoiceType ENUM(
        'Manuelle',
        'Directe',
        'Groupée'
    ) NOT NULL COMMENT 'type of invoice, used for filtering them on different pages',
ADD
    COLUMN reason ENUM(
        'Participation',
        'Pénalité',
        'Annulation',
        'Non-participation'
    ) NOT NULL COMMENT 'reason for invoice, used for indicating if penality or not';