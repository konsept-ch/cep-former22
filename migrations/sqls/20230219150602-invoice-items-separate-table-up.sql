CREATE TABLE
    former22_invoice_item (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The primary id',
        uuid VARCHAR(255) NOT NULL COMMENT 'The UUID of the item',
        invoiceId INT NOT NULL COMMENT 'The invoice of the item (foreign key)',
        designation TEXT COMMENT 'Item designation',
        unit TEXT COMMENT 'Item unit',
        amount TEXT COMMENT 'Item amount',
        price TEXT COMMENT 'Item price',
        vatCode TEXT COMMENT 'Item VAT code',
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Datetime of item creation',
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Datetime of item last update'
    ) DEFAULT CHARSET UTF8 COMMENT 'Items of invoices';