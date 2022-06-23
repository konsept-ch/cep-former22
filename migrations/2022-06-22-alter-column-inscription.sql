ALTER TABLE
    `former22_inscription` CHANGE `updatedAt` `updatedAt` DATETIME on update CURRENT_TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'The date of last modification';