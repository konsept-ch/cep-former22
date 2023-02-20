CREATE TABLE
    former22_evaluation (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the evaluation',
        uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the evaluation',
  		sessionId INT NOT NULL COMMENT 'The ID of the session',
  		templateId INT NOT NULL COMMENT 'The ID of the template',
    ) DEFAULT CHARSET UTF8 COMMENT '';
