ALTER TABLE
	former22_manual_invoice
CHANGE
	COLUMN invoiceType invoiceType ENUM(
		'Manuelle',
		'Directe',
		'Groupée',
		'Quota'
	) NOT NULL COMMENT 'type of invoice, used for filtering them on different pages';
