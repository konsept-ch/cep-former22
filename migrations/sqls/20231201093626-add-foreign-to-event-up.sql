ALTER TABLE `former22_event`
	ADD COLUMN `id` INT(10) NOT NULL AUTO_INCREMENT FIRST,
	DROP PRIMARY KEY,
	DROP COLUMN `eventId`,
	ADD PRIMARY KEY (`id`) USING BTREE,
	ADD UNIQUE INDEX `event_id` (`event_id`),
	ADD CONSTRAINT `fk_event_event` FOREIGN KEY (`event_id`) REFERENCES `claro_cursusbundle_session_event` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
