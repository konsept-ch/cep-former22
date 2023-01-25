CREATE TABLE former22_session (
  sessionId VARCHAR(255) PRIMARY KEY COMMENT 'The ID of the session',
  sessionName TEXT COMMENT 'The name of the session',
  startDate VARCHAR(255) COMMENT 'The start date of the session',
  areInvitesSent BOOLEAN COMMENT 'Are session invites sent'
) DEFAULT CHARSET UTF8 COMMENT '';