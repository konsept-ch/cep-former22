CREATE TABLE former22_user (
  userId VARCHAR(255) NOT NULL PRIMARY KEY COMMENT 'The ID of user',
  shouldReceiveSms BOOLEAN COMMENT 'Should the user receive SMSes'
) DEFAULT CHARSET UTF8 COMMENT '';