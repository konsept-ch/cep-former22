CREATE TABLE former22_event (
  eventId VARCHAR(255) PRIMARY KEY COMMENT 'The ID of the event',
  isFeesPaid BOOLEAN COMMENT 'The boolean if fees is paid or not' DEFAULT false
) DEFAULT CHARSET UTF8 COMMENT '';
