import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const users = await prisma.claro_user.findMany({
    select: {
        id: true,
        uuid: true,
    },
})

const fusers = await prisma.former22_user.findMany({
    select: {
        id: true,
        userId: true,
    },
})

for (const user of fusers) {
    const u = users.find((u) => u.uuid == user.userId)

    await prisma.former22_user.update({
        data: {
            userFk: u.id,
        },
        where: {
            id: user.id,
        },
    })
}
