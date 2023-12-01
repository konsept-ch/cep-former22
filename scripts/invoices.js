import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const users = await prisma.former22_user.findMany({
    select: {
        userId: true,
        cfNumber: true,
    },
})

const invoices = await prisma.former22_manual_invoice.findMany({
    select: {
        uuid: true,
        invoiceNumberForCurrentYear: true,
        courseYear: true,
        claro_user: {
            select: {
                uuid: true,
            },
        },
    },
})

for (const invoice of invoices) {
    const u = users.find((fu) => fu.userId === invoice.claro_user.uuid)

    await prisma.former22_manual_invoice.update({
        data: {
            number: `${`${invoice.courseYear}`.slice(-2)}${`${u.cfNumber}`.padStart(
                2,
                '0'
            )}${`${invoice.invoiceNumberForCurrentYear}`.padStart(4, '0')}`,
        },
        where: {
            uuid: invoice.uuid,
        },
    })
}
