ALTER TABLE
	former22_course
ADD
	COLUMN theme TEXT COMMENT 'The theme of the course',
ADD
	COLUMN targetAudience TEXT COMMENT 'The target audience of the course',
ADD
	COLUMN billingMode TEXT COMMENT 'The billing type of the course',
ADD
	COLUMN pricingType TEXT COMMENT 'The pricing of the course',
ADD
	COLUMN baseRate FLOAT COMMENT 'The base rate of the course';