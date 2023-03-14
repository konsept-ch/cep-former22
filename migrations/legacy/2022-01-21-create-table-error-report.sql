CREATE TABLE former22_error_report (
  errorId VARCHAR(255) PRIMARY KEY COMMENT 'The ID of the error',
  errorDescription TEXT COMMENT 'The description of the error',
  errorDate TEXT COMMENT 'The date of the error'
) DEFAULT CHARSET UTF8 COMMENT '';