ALTER TABLE `former22_course`
	ADD COLUMN `id` INT(10) NOT NULL AUTO_INCREMENT FIRST,
	DROP PRIMARY KEY,
	DROP COLUMN `courseId`,
	ADD PRIMARY KEY (`id`) USING BTREE,
	ADD UNIQUE INDEX `course_id` (`course_id`),
	ADD CONSTRAINT `fk_course_course` FOREIGN KEY (`course_id`) REFERENCES `claro_cursusbundle_course` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;
