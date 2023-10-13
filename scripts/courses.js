import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const courses = await prisma.claro_cursusbundle_course.findMany({
    select: {
        id: true,
        uuid: true,
    },
})

const fcourses = await prisma.former22_course.findMany({
    select: {
        id: true,
        courseId: true,
    },
})

for (const course of fcourses) {
    const c = courses.find((e) => e.uuid === course.courseId)
    if (!c) {
        await prisma.former22_course.delete({
            where: {
                id: course.id,
            },
        })
        continue
    }

    await prisma.former22_course.update({
        data: {
            courseFk: c.id,
        },
        where: {
            id: course.id,
        },
    })
}
