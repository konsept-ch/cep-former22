import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const events = await prisma.former22_event.findMany({
    select: {
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

    if (e) {
        await prisma.former22_event.update({
            data: {
                event_id: e.id,
            },
            where: {
                eventId: event.eventId,
            },
        })
    } else {
        await prisma.former22_event.delete({
            where: {
                eventId: event.eventId,
            },
        })
    }
}
