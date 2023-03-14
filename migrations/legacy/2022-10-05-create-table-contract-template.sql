CREATE TABLE
    former22_contract_template (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the contract template',
        uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the contract template',
        title VARCHAR(255) DEFAULT "Nouveau modèle de contrat" COMMENT 'The title of the contract template',
        description TEXT COMMENT 'The description of the contract template',
        fileStoredName VARCHAR(255) COMMENT 'The generated name for storing the docx file',
        fileOriginalName TEXT COMMENT 'The original name of the uploaded docx file by the user'
    ) DEFAULT CHARSET UTF8 COMMENT '';
