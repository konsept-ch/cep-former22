ALTER TABLE
    former22_evaluation
DROP CONSTRAINT FK_former22_evaluation_claro_cursusbundle_course_session,
DROP CONSTRAINT FK_former22_evaluation_former22_evaluation_template,
DROP INDEX session_index,
DROP INDEX template_index;