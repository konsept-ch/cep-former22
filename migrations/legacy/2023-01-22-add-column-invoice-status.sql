ALTER TABLE
    former22_manual_invoice
ADD
    COLUMN status ENUM(
        'En préparation',
        'A traiter',
        'Non transmissible',
        'Annulée',
        'Envoyée'
    ) NOT NULL COMMENT 'invoice status';

ALTER TABLE former22_manual_invoice DROP COLUMN invoiceStatus;