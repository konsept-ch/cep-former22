import { PrismaClient } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'
//import { STATUSES } from '../src/routes/inscriptionsUtils'

const prisma = new PrismaClient()

const cancellations = await prisma.claro_cursusbundle_course_session_cancellation.findMany()

/*let min = new Date(cancellations[0].registration_date)
let max = new Date(cancellations[0].registration_date)
const map = new Map()

for (const cancellation of cancellations) {
    const i = await prisma.former22_inscription.findUnique({
        select: {
            inscriptionId: true,
        },
        where: {
            inscriptionId: cancellation.inscription_uuid,
        },
    })
    if (i) continue

    const date = new Date(cancellation.registration_date)
    map.set(date.getFullYear(), (map.get(date.getFullYear()) || 0) + 1)

    if (date.getTime() < min.getTime()) {
        min = date
    } else if (date.getTime() > max.getTime()) {
        max = date
    }
}

console.log('Min: ' + min)
console.log('Max: ' + max)
for (const [year, count] of map.entries()) console.log(year + ' = ' + count)*/

for (const cancellation of cancellations) {
    const registration = await prisma.claro_cursusbundle_course_session_user.create({
        select: {
            id: true,
            uuid: true,
        },
        data: {
            uuid: uuidv4(),
            claro_cursusbundle_course_session: {
                connect: {
                    id: cancellation.session_id,
                },
            },
            claro_user: {
                connect: {
                    id: cancellation.user_id,
                },
            },
            registration_type: 'learner',
            registration_date: cancellation.registration_date,
            status: 1,
            remark: '',
            validated: false,
            confirmed: false,
            cancelled: true,
        },
    })

    if (
        await prisma.former22_inscription.findUnique({
            where: {
                inscriptionId: cancellation.inscription_uuid,
            },
        })
    ) {
        await prisma.former22_inscription.update({
            data: {
                inscriptionId: registration.uuid,
            },
            where: {
                inscriptionId: cancellation.inscription_uuid,
            },
        })
    }

    await prisma.former22_invoice_item.updateMany({
        data: {
            inscriptionId: registration.id,
            cancellationId: null,
        },
        where: {
            cancellationId: cancellation.id,
        },
    })
}
