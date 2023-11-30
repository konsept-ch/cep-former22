import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const contracts = await prisma.former22_contract.findMany({
    select: {
        id: true,
        userId: true,
        courseId: true,
    },
})

for (const contract of contracts) {
    const user = await prisma.claro_user.findUnique({
        select: {
            id: true,
        },
        where: {
            uuid: contract.userId,
        },
    })
    const course = await prisma.claro_cursusbundle_course.findUnique({
        select: {
            id: true,
        },
        where: {
            uuid: contract.courseId,
        },
    })

    await prisma.former22_contract.update({
        data: {
            user_id: user.id,
            course_id: course.id,
        },
        where: {
            id: contract.id,
        },
    })
}
