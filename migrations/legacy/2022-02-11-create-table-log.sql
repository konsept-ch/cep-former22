CREATE TABLE former22_log (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The primary id',
    logId VARCHAR(255) COMMENT 'The ID of the change',
    dateAndTime DATETIME COMMENT 'The date and time of the change',
    userEmail VARCHAR(255) COMMENT 'The e-mail of the user who did the change',
    entityType VARCHAR(255) COMMENT 'The type of the entity that was changed',
    entityName TEXT COMMENT 'The name of the entity that was changed',
    entityId VARCHAR(255) COMMENT 'The ID of the entity that was changed',
    actionStatus VARCHAR(255) COMMENT 'The status of the change',
    actionName TEXT COMMENT 'The description of the change'
) DEFAULT CHARSET UTF8 COMMENT '';