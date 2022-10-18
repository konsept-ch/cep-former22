CREATE TABLE
    former22_contract (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the contract',
        uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the contract',
        title VARCHAR(255) DEFAULT "Nouveau modèle de contrat" COMMENT 'The title of the contract template',
        description TEXT COMMENT 'The description of the contract template',
        fileStoredName VARCHAR(255) COMMENT 'The generated name for storing the docx file',
        fileOriginalName TEXT COMMENT 'The original name of the uploaded docx file by the user'
    ) DEFAULT CHARSET UTF8 COMMENT '';

ALTER TABLE former22_course ADD COLUMN contractId INT;

ALTER TABLE
    former22_course
ADD
    INDEX course_index (contractId);

ALTER TABLE
    former22_course
ADD
    CONSTRAINT fk_course_contract FOREIGN KEY (contractId) REFERENCES former22_contract (id) ON DELETE
SET NULL;
