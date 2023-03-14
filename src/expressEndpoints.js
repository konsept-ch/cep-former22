// READ: file expressEndpoints is deprecated, use /routes folder instead

import { v4 as uuidv4 } from 'uuid'

import { sendEmail } from './sendEmail'
import { createService, formatDate } from './utils'
import { prisma } from '.'

// READ: file expressEndpoints is deprecated, use /routes folder instead

export const generateEndpoints = () => {
    // READ: file expressEndpoints is deprecated, use /routes folder instead

    createService('post', '/reportError', async (req, res) => {
        const date = formatDate({
            dateObject: new Date(),
            isDateVisible: true,
            isFullTimeVisible: true,
        })

        const { emailResponse } = await sendEmail({
            to: 'dan@konsept.ch',
            subject: "Rapport d'erreur de l'interface utilisateur",
            html_body: `<h2>Date:${date}</h2><h2>Description:</h2><p><code>${req.body.errorDescription}</code></p>`,
        })

        await prisma.former22_error_report.create({
            data: {
                errorId: uuidv4(),
                errorDescription: req.body.errorDescription,
                errorDate: date,
            },
        })

        res.json({ emailResponse })
    })

    // READ: file expressEndpoints is deprecated, use /routes folder instead

    createService('get', '/logs', async (_req, res) => {
        const logs = await prisma.former22_log.findMany()

        res.json(logs ? 'Des logs trouvés' : 'Aucun log trouvé')
    })

    // READ: file expressEndpoints is deprecated, use /routes folder instead
}
