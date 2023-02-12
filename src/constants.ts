// Remapping prisma values as per this workaround:
// https://github.com/prisma/prisma/issues/8446#issuecomment-1232028974

export const invoiceStatusesFromPrisma = {
    En_pr_paration: 'En préparation',
    A_traiter: 'A traiter',
    Export_e: 'Exportée',
    Non_transmissible: 'Non transmissible',
    Annul_e: 'Annulée',
    Envoy_e: 'Envoyée',
} as const

export const invoiceTypesFromPrisma = {
    Manuelle: 'Manuelle',
    Directe: 'Directe',
    Group_e: 'Groupée',
} as const

export const invoiceReasonsFromPrisma = {
    Participation: 'Participation',
    P_nalit_: 'Pénalité',
    Annulation: 'Annulation',
    Non_participation: 'Non-participation',
} as const
