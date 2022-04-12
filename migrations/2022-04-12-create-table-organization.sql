CREATE TABLE former22_organization (
  id int NOT NULL PRIMARY KEY AUTO_INCREMENT COMMENT 'Primary Key',
  organizationUuid VARCHAR(36) NOT NULL UNIQUE COMMENT 'The ID of the organization',
  billingMode TEXT COMMENT 'The billing mode of the organization',
  dailyRate TEXT COMMENT 'The daily rate of the organization',
  flyersCount INT COMMENT 'The flyers count of the organization',
  phone TEXT COMMENT 'The phone number of the organization',
  addressTitle TEXT COMMENT 'The address title of the organization',
  postalAddressCountry TEXT COMMENT 'The country of the organization',
  postalAddressCountryCode TEXT COMMENT 'The country code of the organization',
  postalAddressCode TEXT COMMENT 'The postal code of the organization',
  postalAddressStreet TEXT COMMENT 'The street of the organization',
  postalAddressDepartment TEXT COMMENT 'The department of the organization',
  postalAddressDepartmentCode TEXT COMMENT 'The department code of the organization',
  postalAddressLocality TEXT COMMENT 'The locality of the organization'
) DEFAULT CHARSET UTF8 COMMENT 'Additional organization fields';