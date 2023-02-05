-- Active: 1664873202055@@127.0.0.1@3306@claroline

UPDATE former22_inscription
SET
    `inscriptionStatus` = 'Annulée non-facturable'
WHERE
    `inscriptionStatus` = 'Annulée';