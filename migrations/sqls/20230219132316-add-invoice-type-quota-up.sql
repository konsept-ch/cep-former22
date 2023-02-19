ALTER TABLE
    former22_manual_invoice MODIFY COLUMN status ENUM(
        'En préparation',
        'A traiter',
        'Exportée',
        'Annulée',
        'Envoyée',
        'Non transmissible',
        'Quotas'
    ) NOT NULL COMMENT 'invoice status';