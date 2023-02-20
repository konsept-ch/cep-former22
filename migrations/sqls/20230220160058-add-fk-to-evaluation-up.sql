ALTER TABLE
    former22_evaluation
ADD
    CONSTRAINT FK_former22_evaluation_claro_cursusbundle_course_session FOREIGN KEY (sessionId) REFERENCES claro_cursusbundle_course_session (id) ON UPDATE NO ACTION ON DELETE NO ACTION,
ADD
    CONSTRAINT FK_former22_evaluation_former22_evaluation_template FOREIGN KEY (templateId) REFERENCES former22_evaluation_template (id) ON UPDATE NO ACTION ON DELETE NO ACTION;
