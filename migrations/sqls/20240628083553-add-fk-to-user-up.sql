ALTER TABLE `former22_user`
	ADD COLUMN `id` INT(10) NOT NULL AUTO_INCREMENT FIRST,
	DROP PRIMARY KEY,
	DROP COLUMN `userId`,
	ADD PRIMARY KEY (`id`) USING BTREE,
	ADD UNIQUE INDEX `user_id` (`user_id`),
	ADD CONSTRAINT `fk_user_user` FOREIGN KEY (`user_id`) REFERENCES `claro_user` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;