ALTER TABLE
    former22_manual_invoice MODIFY COLUMN status ENUM(
        'En préparation',
        'A traiter',
        'Exportée',
        'Non transmissible',
        'Annulée',
        'Envoyée',
        'Quotas',
		'Traitée'
    ) NOT NULL COMMENT 'invoice status';
