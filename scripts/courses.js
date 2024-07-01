import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const entities = await prisma.former22_course.findMany({
    select: {
        courseId: true,
    },
})

for (const entity of entities) {
    const e = await prisma.claro_cursusbundle_course.findUnique({
        select: {
            id: true,
        },
        where: {
            uuid: entity.courseId,
        },
    })

    if (e) {
        await prisma.former22_course.update({
            data: {
                course_id: e.id,
            },
            where: {
                courseId: entity.courseId,
            },
        })
    } else {
        await prisma.former22_course.delete({
            where: {
                courseId: entity.courseId,
            },
        })
    }
}
