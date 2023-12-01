import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const events = await prisma.former22_event.findMany({
    select: {
        id: true,
        eventId: true,
    },
})

for (const event of events) {
    const e = await prisma.claro_cursusbundle_session_event.findUnique({
        select: {
            id: true,
        },
        where: {
            uuid: event.eventId,
        },
    })

    await prisma.former22_event.update({
        data: {
            event_id: e.id,
        },
        where: {
            id: event.id,
        },
    })
}
