import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const cancellations = await prisma.claro_cursusbundle_course_session_cancellation.findMany()

const map = new Map()

for (const i of cancellations) {
    map.set(i.inscription_uuid, map.get(i.inscription_uuid) ? [...map.get(i.inscription_uuid), i.id] : [i.id])
}

for (const [uuid, ids] of map) {
    if (ids.length < 2) continue
    if (
        (await prisma.former22_invoice_item.count({
            where: {
                claro_cursusbundle_course_session_cancellation: {
                    uuid,
                },
            },
        })) > 0
    )
        continue

    await prisma.claro_cursusbundle_course_session_cancellation.deleteMany({
        where: { id: { in: ids.slice(1) } },
    })
}
