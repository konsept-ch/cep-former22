ALTER TABLE
    former22_log
ADD
    dateAndTimeConverted DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'The date and time of the change';

UPDATE
    former22_log
SET
    former22_log.dateAndTimeConverted = FROM_UNIXTIME(dateAndTime / 1000);

ALTER TABLE former22_log DROP COLUMN dateAndTime;

ALTER TABLE
    former22_log CHANGE dateAndTimeConverted dateAndTime DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'The date and time of the change';