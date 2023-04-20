ALTER TABLE
    `former22_invoice_item`
ADD
    COLUMN `cancellationId` INT NULL AFTER `updatedAt`,
ADD
    INDEX `cancellation_index` (`cancellationId`),
ADD
    CONSTRAINT `FK_former22_invoice_item_claro_course_session_cancellation` FOREIGN KEY (`cancellationId`) REFERENCES `claro_cursusbundle_course_session_cancellation` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
