CREATE TABLE
    former22_manual_invoice (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The primary id',
        uuid VARCHAR(255) NOT NULL COMMENT 'The UUID of the invoice',
        organizationId INT NOT NULL COMMENT 'The selected organization of the invoice (foreign key)',
        creatorUserId INTEGER NOT NULL COMMENT 'The CF user ID of the invoice (foreign key)',
        invoiceStatus TEXT COMMENT 'The status of the invoice',
        invoiceNumberForCurrentYear INTEGER NOT NULL COMMENT 'The number of the invoice for the current year',
        customClientEmail TEXT COMMENT 'The custom client e-mail of the invoice',
        customClientAddress TEXT COMMENT 'The custom client address of the invoice',
        invoiceDate DATETIME COMMENT 'The date of the invoice',
        courseYear INTEGER NOT NULL COMMENT 'The course year of the invoice',
        itemDesignations TEXT COMMENT 'Each item designation, separated by |',
        itemUnits TEXT COMMENT 'Each item unit, separated by |',
        itemAmounts TEXT COMMENT 'Each item amount, separated by |',
        itemPrices TEXT COMMENT 'Each item price, separated by |',
        itemVatCodes TEXT COMMENT 'Each item vat code, separated by |',
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Datetime of invoice creation',
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Datetime of invoice last update'
    ) DEFAULT CHARSET UTF8 COMMENT 'Manual invoices';

ALTER TABLE
    former22_manual_invoice
ADD
    INDEX organization_index (organizationId);

ALTER TABLE
    former22_manual_invoice
ADD
    CONSTRAINT fk_manual_invoice_organization FOREIGN KEY (organizationId) REFERENCES claro__organization (id);

ALTER TABLE
    former22_manual_invoice
ADD
    INDEX creator_user_index (creatorUserId);

ALTER TABLE
    former22_manual_invoice
ADD
    CONSTRAINT fk_manual_invoice_creator_user FOREIGN KEY (creatorUserId) REFERENCES claro_user (id);