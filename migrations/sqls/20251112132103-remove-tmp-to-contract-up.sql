ALTER TABLE `former22_contract`
	DROP COLUMN `templateId`,
	DROP FOREIGN KEY `fk_contract_template`,
	DROP INDEX `fk_contract_template`;
