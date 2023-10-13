ALTER TABLE `former22_event`
CHANGE COLUMN `eventFk` `eventId` INT(11) NOT NULL AFTER `fees`,
DROP COLUMN `eventId`,
ADD UNIQUE INDEX `eventId` (`eventId`),
ADD CONSTRAINT `FK_former22_event_claro_cursusbundle_session_event` FOREIGN KEY (`eventId`) REFERENCES `claro_cursusbundle_session_event` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
