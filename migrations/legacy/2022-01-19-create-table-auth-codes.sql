CREATE TABLE former22_auth_codes (
  email VARCHAR(255) PRIMARY KEY COMMENT 'The email that receives the code',
  code VARCHAR(255) COMMENT 'The code that is sent to the email',
  sendTimestamp BIGINT COMMENT 'The unix timestamp when the code was sent (valid for a few minutes)'
) DEFAULT CHARSET UTF8 COMMENT 'Auth table with email-code pairs';