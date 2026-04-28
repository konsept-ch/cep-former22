require('dotenv').config()

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const middlewareUrl = process.env.FORMER22_TEST_URL ?? 'http://localhost:4000'
const attestationTemplateFilesDest = '/data/uploads/attestation-templates'

async function findAdminAuth() {
    const adminToken = await prisma.claro_api_token.findFirst({
        where: {
            is_locked: false,
            claro_user: {
                claro_user_role: {
                    some: {
                        claro_role: {
                            translation_key: 'admin',
                        },
                    },
                },
            },
        },
        select: {
            token: true,
            claro_user: {
                select: {
                    mail: true,
                },
            },
        },
    })

    assert(adminToken, 'No unlocked admin API token found in local DB.')

    return {
        email: adminToken.claro_user.mail,
        token: adminToken.token,
    }
}

async function findTestInscription() {
    const former22Inscriptions = await prisma.former22_inscription.findMany({
        take: 500,
        select: {
            inscriptionId: true,
            attestationId: true,
        },
    })

    const inscriptionIds = former22Inscriptions.map(({ inscriptionId }) => inscriptionId)

    const courseSessionUser = await prisma.claro_cursusbundle_course_session_user.findFirst({
        where: {
            uuid: {
                in: inscriptionIds,
            },
            claro_user: {
                workspace_id: {
                    not: null,
                },
            },
        },
        select: {
            uuid: true,
        },
    })

    assert(courseSessionUser, 'No local inscription with a Former22 mirror row and personal workspace found.')

    const former22Inscription = former22Inscriptions.find(
        ({ inscriptionId }) => inscriptionId === courseSessionUser.uuid
    )

    return former22Inscription
}

async function findMissingTemplate(currentAttestationId) {
    const attestations = await prisma.former22_attestation.findMany({
        select: {
            id: true,
            uuid: true,
            fileStoredName: true,
        },
    })

    const missingAttestation = attestations.find(
        ({ id, fileStoredName }) =>
            id !== currentAttestationId && !fs.existsSync(path.resolve(attestationTemplateFilesDest, fileStoredName))
    )

    assert(missingAttestation, 'No attestation template with a missing local file found.')

    return missingAttestation
}

async function main() {
    const auth = await findAdminAuth()
    const inscription = await findTestInscription()
    const attestation = await findMissingTemplate(inscription.attestationId)

    const response = await fetch(`${middlewareUrl}/attestations/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-login-email-address': auth.email,
            'x-login-email-code': '000000',
            'x-login-token': auth.token,
        },
        body: JSON.stringify({
            uuids: [inscription.inscriptionId],
            selectedAttestationTemplateUuid: attestation.uuid,
        }),
    })

    assert.equal(response.status, 500, 'Missing template generation should fail with HTTP 500.')

    const updatedInscription = await prisma.former22_inscription.findUnique({
        where: {
            inscriptionId: inscription.inscriptionId,
        },
        select: {
            attestationId: true,
        },
    })

    assert.equal(
        updatedInscription.attestationId,
        inscription.attestationId,
        'attestationId must not change when the template file is missing.'
    )

    console.info(
        `OK: missing template ${attestation.fileStoredName} failed without changing inscription ${inscription.inscriptionId}.`
    )
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
