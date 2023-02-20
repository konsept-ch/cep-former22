ALTER TABLE
    former22_evaluation
ADD
    INDEX session_index (sessionId),
ADD
    INDEX template_index (templateId);
