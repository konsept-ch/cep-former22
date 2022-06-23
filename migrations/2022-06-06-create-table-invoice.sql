CREATE TABLE former22_invoice (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The primary id',
    invoiceId VARCHAR(255) NOT NULL COMMENT 'The ID of the invoice',
    inscriptionId INT NOT NULL COMMENT 'The inscription primary ID of the invoice',
    participantName VARCHAR(255) COMMENT 'The name of the participant',
    tutorsNames VARCHAR(255) COMMENT 'The names of the tutors',
    courseName VARCHAR(255) COMMENT 'The name of thecourse',
    sessionName VARCHAR(255) COMMENT 'The name of the session of the course',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Datetime of invoice creation'
) DEFAULT CHARSET UTF8 COMMENT '';

ALTER TABLE
    former22_invoice
ADD
    INDEX inscription_index (inscriptionId);

ALTER TABLE
    former22_invoice
ADD
    CONSTRAINT fk_inscription FOREIGN KEY (inscriptionId) REFERENCES claro_cursusbundle_course_session_user (id);

ALTER TABLE former22_invoice ADD UNIQUE INDEX (invoiceId);