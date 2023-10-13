import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const sessions = await prisma.claro_cursusbundle_course_session.findMany({
    select: {
        id: true,
        uuid: true,
    },
})

const fsessions = await prisma.former22_session.findMany({
    select: {
        id: true,
        sessionId: true,
    },
})

for (const session of fsessions) {
    const x = sessions.find((e) => e.uuid === session.sessionId)

    if (!x) {
        await prisma.former22_session.delete({
            where: {
                id: session.id,
            },
        })
        continue
    }

    await prisma.former22_session.update({
        data: {
            sessionFk: x.id,
        },
        where: {
            id: session.id,
        },
    })
}
