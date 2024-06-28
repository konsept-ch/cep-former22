import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const sessions = await prisma.former22_session.findMany({
    select: {
        sessionId: true,
    },
})

for (const session of sessions) {
    const s = await prisma.claro_cursusbundle_course_session.findUnique({
        select: {
            id: true,
        },
        where: {
            uuid: session.sessionId,
        },
    })

    if (s) {
        await prisma.former22_session.update({
            data: {
                session_id: s.id,
            },
            where: {
                sessionId: session.sessionId,
            },
        })
    } else {
        await prisma.former22_session.delete({
            where: {
                sessionId: session.sessionId,
            },
        })
    }
}
