ALTER TABLE `former22_user`
CHANGE COLUMN `userFk` `userId` INT(11) NOT NULL AFTER `cfNumber`,
DROP COLUMN `userId`,
ADD CONSTRAINT `FK_former22_user_claro_user` FOREIGN KEY (`userId`) REFERENCES `claro_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
