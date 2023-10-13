ALTER TABLE `former22_course`
CHANGE COLUMN `courseFk` `courseId` INT(11) NOT NULL AFTER `goals`,
DROP COLUMN `courseId`,
ADD UNIQUE INDEX `courseId` (`courseId`),
ADD CONSTRAINT `FK_former22_course_claro_cursusbundle_course` FOREIGN KEY (`courseId`) REFERENCES `claro_cursusbundle_course` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;
