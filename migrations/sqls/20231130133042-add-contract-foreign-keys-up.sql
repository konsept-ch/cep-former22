ALTER TABLE `former22_contract`
	ADD COLUMN `user_id` INT(10) NOT NULL COMMENT 'The ID of the user' AFTER `year`,
	ADD COLUMN `course_id` INT(10) NOT NULL COMMENT 'The ID of the course' AFTER `user_id`;
