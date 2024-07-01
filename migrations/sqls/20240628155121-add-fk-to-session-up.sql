ALTER TABLE `former22_session`
	ADD COLUMN `id` INT(10) NOT NULL AUTO_INCREMENT FIRST,
	DROP PRIMARY KEY,
	DROP COLUMN `sessionId`,
	ADD PRIMARY KEY (`id`) USING BTREE,
	ADD UNIQUE INDEX `session_id` (`session_id`),
	ADD CONSTRAINT `fk_session_session` FOREIGN KEY (`session_id`) REFERENCES `claro_cursusbundle_course_session` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;
