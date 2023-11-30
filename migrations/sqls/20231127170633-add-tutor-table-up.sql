CREATE TABLE `former22_tutor` (
	`id` INT(10) NOT NULL AUTO_INCREMENT,
	`inscriptionId` INT(10) UNIQUE NOT NULL,
	`json` JSON NOT NULL,
	PRIMARY KEY (`id`) USING BTREE,
	INDEX `tutor_inscription` (`inscriptionId`) USING BTREE,
	CONSTRAINT `tutor_inscription` FOREIGN KEY (`inscriptionId`) REFERENCES `claro_cursusbundle_course_session_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
