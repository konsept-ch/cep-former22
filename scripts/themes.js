import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const themes = {
    'Informatique & Compétences numériques': 'Numériques',
    'Administration & Politiques publiques': 'Spécifiques à l’administration publique',
    'Intelligence collective & Agilité': 'Pédagogiques et de facilitation',
    'Organisation & Management': 'Managériales et de leadership',
    'Communication & Relations': 'Sociales',
    'Efficacité personnelle': 'Personnelles',
    'Prévention & Santé': 'Méthodologiques et organisationnelles',
    Apprentissage: 'Apprentissage',
}

for (const old in themes) {
    await prisma.former22_course.updateMany({
        data: {
            theme: themes[old],
        },
        where: {
            theme: old,
        },
    })
}
