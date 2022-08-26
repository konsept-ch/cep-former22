CREATE TABLE
    former22_attestations (
        idModel VARCHAR(255) PRIMARY KEY COMMENT 'The ID of the attestation',
        title VARCHAR(255) COMMENT 'The title of the attestation template',
        descriptionText TEXT COMMENT 'The description of the attestation template',
        path VARCHAR(255) COMMENT 'The path of the docx file',
        filename TEXT COMMENT 'The original name of the docx file'
    ) DEFAULT CHARSET UTF8 COMMENT '';