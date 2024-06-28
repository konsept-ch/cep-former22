import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const users = await prisma.former22_user.findMany({
    select: {
        userId: true,
    },
})

for (const user of users) {
    const u = await prisma.claro_user.findUnique({
        select: {
            id: true,
        },
        where: {
            uuid: user.userId,
        },
    })

    if (u) {
        await prisma.former22_user.update({
            data: {
                user_id: u.id,
            },
            where: {
                userId: user.userId,
            },
        })
    } else {
        await prisma.former22_user.delete({
            where: {
                userId: user.userId,
            },
        })
    }
}
