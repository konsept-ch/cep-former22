/**
 * Garde-fou : l'index de prefixe sur claro_resource_node.path doit exister.
 *
 * C'est la correction de la cause racine de l'incident attestations de septembre 2026.
 * Sans cet index, l'extension Gedmo Tree balaye toute la table a chaque creation de
 * ressource (mesure : 5,1 s sur 140 195 lignes), ce qui fait depasser le delai
 * d'execution en production et rend HTTP 500. Le middleware avalait l'erreur, d'ou des
 * attestations annoncees comme generees et absentes des comptes participants.
 *
 * Ce script echoue si :
 *   - l'index a disparu (base recreee sans la migration Version20260925000000) ;
 *   - le plan d'execution de la requete de Gedmo retombe sur un balayage complet.
 *
 * Lecture seule. A lancer contre une base LOCALE.
 *
 *   node scripts/verify-resource-node-path-index.cjs
 *
 * docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 */
require('dotenv').config()

const assert = require('node:assert/strict')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const SEUIL_LIGNES_EXAMINEES = 1000

async function main() {
    // 1. l'index existe-t-il ?
    const index = await prisma.$queryRawUnsafe(`
        SELECT INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SUB_PART AS subPart
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'claro_resource_node'
          AND COLUMN_NAME = 'path'
    `)

    assert.ok(
        index.length > 0,
        "claro_resource_node.path n'a aucun index. La migration Version20260925000000 " +
            "n'a pas ete appliquee : chaque creation de ressource va balayer toute la table."
    )

    const [{ indexName, subPart }] = index
    assert.ok(
        Number(subPart) > 0,
        `L'index ${indexName} sur path n'a pas de longueur de prefixe : verifier la migration.`
    )

    // 2. le plan d'execution tient-il ?
    const racine = await prisma.$queryRawUnsafe(`
        SELECT path FROM claro_resource_node WHERE path IS NOT NULL AND path <> '' LIMIT 1
    `)

    if (racine.length === 0) {
        // eslint-disable-next-line no-console
        console.log('Base vide : controle du plan d execution ignore.')
    } else {
        const prefixe = String(racine[0].path)
            .slice(0, 60)
            .replace(/[\\%_']/g, '')
        // EXPLAIN classique rend des colonnes sans nom via Prisma (f0..f11) : on passe par
        // FORMAT=JSON, dont la forme est stable et nommee.
        const plan = await prisma.$queryRawUnsafe(`
            EXPLAIN FORMAT=JSON SELECT id FROM claro_resource_node
            WHERE path LIKE '${prefixe}%' ORDER BY path ASC
        `)

        const brut = Object.values(plan[0])[0]
        const queryBlock = JSON.parse(typeof brut === 'string' ? brut : String(brut)).query_block

        // avec un ORDER BY, MySQL imbrique la table sous ordering_operation
        const table = queryBlock.table ?? queryBlock.ordering_operation?.table
        const type = table?.access_type
        const key = table?.key
        const rows = table?.rows_examined_per_scan

        assert.notEqual(
            type,
            'ALL',
            `Le plan d execution est retombe sur un balayage complet (${rows} lignes). ` +
                "L'index sur path n'est pas utilise."
        )
        assert.ok(key, 'Aucun index retenu par le planificateur pour la requete de Gedmo Tree.')
        assert.ok(
            Number(rows) < SEUIL_LIGNES_EXAMINEES,
            `Le planificateur annonce ${rows} lignes examinees, au-dela du seuil de ${SEUIL_LIGNES_EXAMINEES}.`
        )

        // eslint-disable-next-line no-console
        console.log(`Plan d execution : type=${type}, index=${key}, lignes=${rows}`)
    }

    // eslint-disable-next-line no-console
    console.log(`OK — index ${indexName} present sur claro_resource_node.path (prefixe ${subPart}).`)
}

main()
    .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`ECHEC — ${error.message}`)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
