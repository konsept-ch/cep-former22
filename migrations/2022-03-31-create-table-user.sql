CREATE TABLE former22_user (
  userId VARCHAR(255) NOT NULL PRIMARY KEY COMMENT 'The ID of user',
  isReceivingSms BOOLEAN COMMENT 'Is the user receiving SMSes'
) DEFAULT CHARSET UTF8 COMMENT '';