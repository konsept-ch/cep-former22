CREATE TABLE former22_course (
  courseId VARCHAR(255) PRIMARY KEY COMMENT 'The ID of the course',
  coordinator TEXT COMMENT 'The coordinator of the course',
  responsible TEXT COMMENT 'Who is responsible of the course',
  typeStage TEXT COMMENT 'The type stage of the course',
  teachingMethod TEXT COMMENT 'The teaching method of the course',
  codeCategory TEXT COMMENT 'The code category of the course'
) DEFAULT CHARSET UTF8 COMMENT '';