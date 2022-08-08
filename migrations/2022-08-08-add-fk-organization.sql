ALTER TABLE
    former22_organization
ADD
    COLUMN organizationId INT UNIQUE;

ALTER TABLE
    former22_organization
ADD
    INDEX organization_index (organizationId);

ALTER TABLE
    former22_organization
ADD
    CONSTRAINT fk_organization FOREIGN KEY (organizationId) REFERENCES claro__organization (id);