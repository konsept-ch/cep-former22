// Remapping prisma values as per this workaround:
// https://github.com/prisma/prisma/issues/8446#issuecomment-1232028974

export const invoiceStatusesFromPrisma = {
    En_pr_paration: 'En préparation',
    A_traiter: 'A traiter',
    Export_e: 'Exportée',
    Annul_e: 'Annulée',
    Envoy_e: 'Envoyée',
    Non_transmissible: 'Non transmissible',
    Quotas: 'Quotas',
}

export const invoiceTypesFromPrisma = {
    Manuelle: 'Manuelle',
    Directe: 'Directe',
    Group_e: 'Groupée',
    Quota: 'Quota',
}

export const invoiceReasonsFromPrisma = {
    Participation: 'Participation',
    P_nalit_: 'Pénalité',
    Annulation: 'Annulation',
    Non_participation: 'Non-participation',
}
