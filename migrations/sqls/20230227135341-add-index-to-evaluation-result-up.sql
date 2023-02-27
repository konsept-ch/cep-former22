ALTER TABLE
    former22_evaluation_result
ADD
    INDEX evaluation_index (evaluationId),
ADD
    CONSTRAINT FK_former22_evaluation_result_evaluation FOREIGN KEY (evaluationId) REFERENCES former22_evaluation (id) ON UPDATE NO ACTION ON DELETE NO ACTION;
