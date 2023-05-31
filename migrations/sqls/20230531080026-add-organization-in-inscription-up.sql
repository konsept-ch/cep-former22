ALTER TABLE
    `former22_inscription`
ADD
    COLUMN `organizationId` INT NULL,
ADD
    INDEX `organization_index` (`organizationId`),
ADD
    CONSTRAINT `FK_inscription_organization` FOREIGN KEY (`organizationId`) REFERENCES `former22_organization` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
