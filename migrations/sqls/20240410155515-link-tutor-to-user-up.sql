ALTER TABLE `former22_tutor`
	ADD COLUMN `userId` INT(10) UNIQUE NOT NULL AFTER `id`,
	DROP COLUMN `inscriptionId`,
	ADD INDEX `tutor_user` (`userId`),
    ADD CONSTRAINT `FK_tutor_user` FOREIGN KEY (`userId`) REFERENCES `claro_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
