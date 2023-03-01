ALTER TABLE
    `former22_invoice_item`
ADD
    COLUMN `inscriptionId` INT NULL AFTER `updatedAt`,
ADD
    INDEX `inscription_index` (`inscriptionId`),
ADD
    CONSTRAINT `FK_former22_invoice_item_claro_cursusbundle_course_session_user` FOREIGN KEY (`inscriptionId`) REFERENCES `claro_cursusbundle_course_session_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;