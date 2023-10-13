ALTER TABLE `former22_session`
CHANGE COLUMN `sessionFk` `sessionId` INT(11) NOT NULL AFTER `sessionLocation`,
DROP COLUMN `sessionId`,
ADD UNIQUE INDEX `sessionId` (`sessionId`),
ADD CONSTRAINT `FK_former22_session_claro_cursusbundle_course_session` FOREIGN KEY (`sessionId`) REFERENCES `claro_cursusbundle_course_session` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
