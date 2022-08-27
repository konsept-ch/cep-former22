CREATE TABLE
    former22_attestations (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the attestation',
        uuid VARCHAR(36) UNIQUE COMMENT 'The ID of the attestation',
        title VARCHAR(255) DEFAULT "Nouveau modèle d'attestation" COMMENT 'The title of the attestation template',
        description TEXT COMMENT 'The description of the attestation template',
        filePath VARCHAR(255) COMMENT 'The path of the docx file',
        fileName TEXT COMMENT 'The original name of the docx file'
    ) DEFAULT CHARSET UTF8 COMMENT '';