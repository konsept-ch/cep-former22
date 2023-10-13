import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const events = await prisma.claro_cursusbundle_session_event.findMany({
    select: {
        id: true,
        uuid: true,
    },
})

const fevents = await prisma.former22_event.findMany({
    select: {
        id: true,
        eventId: true,
    },
})

for (const event of fevents) {
    const x = events.find((e) => e.uuid === event.eventId)

    if (!x) {
        await prisma.former22_event.delete({
            where: {
                id: event.id,
            },
        })
        continue
    }

    await prisma.former22_event.update({
        data: {
            eventFk: x.id,
        },
        where: {
            id: event.id,
        },
    })
}
