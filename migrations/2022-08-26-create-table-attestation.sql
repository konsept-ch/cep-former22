CREATE TABLE
    former22_attestation (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the attestation',
        uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the attestation',
        title VARCHAR(255) DEFAULT "Nouveau modèle d'attestation" COMMENT 'The title of the attestation template',
        description TEXT COMMENT 'The description of the attestation template',
        fileStoredName VARCHAR(255) COMMENT 'The generated name for storing the docx file',
        fileOriginalName TEXT COMMENT 'The original name of the uploaded docx file by the user'
    ) DEFAULT CHARSET UTF8 COMMENT '';

ALTER TABLE
    former22_inscription
ADD COLUMN attestationId INT;

ALTER TABLE
    former22_inscription
ADD
    INDEX inscription_index (attestationId);

ALTER TABLE
    former22_inscription
ADD
    CONSTRAINT fk_inscription_attestation FOREIGN KEY (attestationId) REFERENCES former22_attestation (id);