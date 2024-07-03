import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const cancellations = await prisma.claro_cursusbundle_course_session_cancellation.findMany()

const map = new Map()

for (const i of cancellations) map.set(i.inscription_uuid, [...(map.get(i.inscription_uuid) || []), i.id])

let counter = 0
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

    counter = counter + 1
}

console.log(`Removed = ${counter}`)
