CREATE TABLE
    former22_evaluation_template (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the evaluation template',
        uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the evaluation template',
        title VARCHAR(255) DEFAULT "Nouveau modèle d'évaluation" COMMENT 'The title of the evaluation template',
        description TEXT COMMENT 'The description of the evaluation template',
        struct JSON COMMENT 'The structure of evaluation'
    ) DEFAULT CHARSET UTF8 COMMENT '';
