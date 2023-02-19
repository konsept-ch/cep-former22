ALTER TABLE
    `former22_invoice_item`
ADD
    CONSTRAINT `FK_former22_invoice_item_former22_manual_invoice` FOREIGN KEY (`invoiceId`) REFERENCES `former22_manual_invoice` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;