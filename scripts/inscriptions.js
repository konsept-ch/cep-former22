import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const inscriptions = await prisma.claro_cursusbundle_course_session_user.findMany({
    select: {
        id: true,
        uuid: true,
    },
})

const cancellations = await prisma.claro_cursusbundle_course_session_cancellation.findMany({
    select: {
        id: true,
        uuid: true,
    },
})

const finscriptions = await prisma.former22_inscription.findMany({
    select: {
        id: true,
        inscriptionId: true,
        inscriptionStatus: true,
    },
})

const log = {
    count: 0,
    map: new Map(),
}
for (const inscription of finscriptions) {
    const x = inscriptions.find((e) => e.uuid === inscription.inscriptionId)
    const y = cancellations.find((e) => e.uuid === inscription.inscriptionId)

    if (!x && !y) {
        log.count = log.count + 1
        if (log.count < 3) console.log(inscription.inscriptionId)
        log.map.set(inscription.inscriptionStatus, (log.map.get(inscription.inscriptionStatus) || 0) + 1)
    }

    /*if (!x) {
        await prisma.former22_inscription.delete({
            where: {
                id: inscription.id,
            },
        })
        continue
    }

    await prisma.former22_inscription.update({
        data: {
            inscriptionFk: x.id,
        },
        where: {
            id: inscription.id,
        },
    })*/
}

console.log(`Total in claroline: ${inscriptions.length + cancellations.length}`)
console.log(`Total in former22: ${finscriptions.length}`)
console.log(`Deleted from claroline: ${log.count}`)
console.log(log.map)
