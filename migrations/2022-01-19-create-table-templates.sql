CREATE TABLE former22_template (
  templateId VARCHAR(255) PRIMARY KEY COMMENT 'The ID of the template',
  title VARCHAR(255) COMMENT 'The title of the template',
  descriptionText TEXT COMMENT 'The description of the template',
  emailSubject TEXT COMMENT 'The email subject',
  smsBody TEXT COMMENT 'The sms content',
  emailBody TEXT COMMENT 'The email content',
  statuses TEXT COMMENT 'The statuses for which the template can be used',
  isUsedForSessionInvites BOOLEAN COMMENT 'Is the template used for session invites'
) DEFAULT CHARSET UTF8 COMMENT '';