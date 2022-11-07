CREATE TABLE former22_contract (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the contract',
  uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the contract',
  userId VARCHAR(36) NOT NULL COMMENT 'The ID of the user',
  courseId VARCHAR(36) NOT NULL COMMENT 'The ID of the course',
  templateId INT NOT NULL COMMENT 'The ID of the template',

  CONSTRAINT fk_contract_template FOREIGN KEY (templateId) REFERENCES former22_contract_template(id)
) DEFAULT CHARSET UTF8 COMMENT '';
