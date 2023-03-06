CREATE TABLE
    former22_evaluation_result (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'The ID of the evaluation',
        uuid VARCHAR(36) UNIQUE NOT NULL COMMENT 'The ID of the evaluation',
  		evaluationId INT NOT NULL COMMENT 'The ID of the evaluation',
        result JSON COMMENT 'The result of evaluation with same structure of evaluation'
    ) DEFAULT CHARSET UTF8 COMMENT '';
