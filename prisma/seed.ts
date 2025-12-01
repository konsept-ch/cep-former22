import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ids = {
    organizationUuid: 'seed-org-0001',
    organizationCode: 'ORG-SEED-001',
    adminUuid: 'seed-user-admin-0001',
    learnerUuid: 'seed-user-learner-0001',
    courseUuid: 'seed-course-0001',
    sessionUuid: 'seed-session-0001',
    plannedObjectUuid: 'seed-planned-object-0001',
    sessionEventUuid: 'seed-session-event-0001',
    sessionUserUuid: 'seed-inscription-0001',
    sessionEventUserUuid: 'seed-event-user-0001',
    cancellationUuid: 'seed-cancellation-0001',
    manualInvoiceUuid: 'seed-manual-invoice-0001',
    invoiceItemUuid: 'seed-invoice-item-0001',
    invoiceUuid: 'seed-invoice-0001',
    attestationUuid: 'seed-attestation-0001',
    evaluationTemplateUuid: 'seed-eval-template-0001',
    evaluationUuid: 'seed-evaluation-0001',
    evaluationResultUuid: 'seed-eval-result-0001',
    templateId: 'seed-template-0001',
    authEmail: 'dev@example.com',
    errorId: 'seed-error-0001',
    contractTemplateUuid: 'seed-contract-template-0001',
    contractUuid: 'seed-contract-0001',
    eventId: 'seed-event-0001',
}

const now = new Date()

async function upsertOrganization() {
    return prisma.claro__organization.upsert({
        where: { uuid: ids.organizationUuid },
        update: {
            name: 'Seed Organization',
            email: 'org@example.com',
            lft: 1,
            lvl: 0,
            rgt: 2,
            is_default: true,
            type: 'organization',
            maxUsers: 500,
            code: ids.organizationCode,
            is_public: true,
        },
        create: {
            name: 'Seed Organization',
            email: 'org@example.com',
            lft: 1,
            lvl: 0,
            rgt: 2,
            is_default: true,
            type: 'organization',
            maxUsers: 500,
            code: ids.organizationCode,
            is_public: true,
            uuid: ids.organizationUuid,
        },
    })
}

async function upsertUser({
    uuid,
    firstName,
    lastName,
    username,
    mail,
}: {
    uuid: string
    firstName: string
    lastName: string
    username: string
    mail: string
}) {
    return prisma.claro_user.upsert({
        where: { uuid },
        update: {
            first_name: firstName,
            last_name: lastName,
            username,
            mail,
            creation_date: now,
            is_enabled: true,
            is_removed: false,
            is_locked: false,
            is_mail_notified: true,
            is_mail_validated: true,
        },
        create: {
            first_name: firstName,
            last_name: lastName,
            username,
            mail,
            creation_date: now,
            is_enabled: true,
            is_removed: false,
            is_locked: false,
            is_mail_notified: true,
            is_mail_validated: true,
            uuid,
            password: 'seed-password',
            salt: 'seed-salt',
            locale: 'fr',
            code: 'SEED',
        },
    })
}

async function upsertCourse(adminId: number) {
    return prisma.claro_cursusbundle_course.upsert({
        where: { uuid: ids.courseUuid },
        update: {
            course_name: 'Introduction to DGCS',
            code: 'DGCS-INTRO',
            description: 'Seed course for development data',
            public_registration: true,
            public_unregistration: true,
            registration_validation: false,
            user_validation: false,
            max_users: 50,
            entity_order: 1,
            slug: 'dgcs-intro',
            registration_mail: true,
            price: 1200,
            priceDescription: 'Standard rate',
            sessionOpening: '08:00',
            auto_registration: false,
            pending_registrations: false,
            hideSessions: false,
            session_days: 2,
            updatedAt: now,
            creator_id: adminId,
        },
        create: {
            course_name: 'Introduction to DGCS',
            code: 'DGCS-INTRO',
            description: 'Seed course for development data',
            public_registration: true,
            public_unregistration: true,
            registration_validation: false,
            user_validation: false,
            max_users: 50,
            entity_order: 1,
            uuid: ids.courseUuid,
            slug: 'dgcs-intro',
            registration_mail: true,
            price: 1200,
            priceDescription: 'Standard rate',
            sessionOpening: '08:00',
            auto_registration: false,
            pending_registrations: false,
            hideSessions: false,
            session_days: 2,
            createdAt: now,
            updatedAt: now,
            creator_id: adminId,
            propagateRegistration: false,
        },
    })
}

async function upsertSession(courseId: number, adminId: number) {
    return prisma.claro_cursusbundle_course_session.upsert({
        where: { uuid: ids.sessionUuid },
        update: {
            course_id: courseId,
            course_name: 'Introduction to DGCS - Session 1',
            default_session: true,
            start_date: now,
            end_date: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
            code: 'DGCS-INTRO-SESSION-1',
            description: 'Seed session',
            public_registration: true,
            public_unregistration: true,
            registration_validation: false,
            user_validation: false,
            max_users: 30,
            entity_order: 1,
            registration_mail: true,
            price: 600,
            priceDescription: 'Per participant',
            used_by_quotas: false,
            quota_days: 2,
            hidden: false,
            auto_registration: false,
            pending_registrations: false,
            updatedAt: now,
            creator_id: adminId,
        },
        create: {
            course_id: courseId,
            course_name: 'Introduction to DGCS - Session 1',
            default_session: true,
            createdAt: now,
            start_date: now,
            end_date: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
            event_registration_type: 0,
            code: 'DGCS-INTRO-SESSION-1',
            description: 'Seed session',
            public_registration: true,
            public_unregistration: true,
            registration_validation: false,
            user_validation: false,
            max_users: 30,
            entity_order: 1,
            uuid: ids.sessionUuid,
            registration_mail: true,
            price: 600,
            priceDescription: 'Per participant',
            used_by_quotas: false,
            quota_days: 2,
            hidden: false,
            auto_registration: false,
            pending_registrations: false,
            creator_id: adminId,
            updatedAt: now,
        },
    })
}

async function upsertPlannedObject(adminId: number) {
    return prisma.claro_planned_object.upsert({
        where: { uuid: ids.plannedObjectUuid },
        update: {
            event_type: 'training',
            start_date: now,
            end_date: new Date(now.getTime() + 2 * 60 * 60 * 1000),
            color: '#336699',
            description: 'Seed session event',
            entity_name: 'DGCS Intro - Day 1',
            createdAt: now,
            updatedAt: now,
            event_class: 'session_event',
            creator_id: adminId,
        },
        create: {
            event_type: 'training',
            start_date: now,
            end_date: new Date(now.getTime() + 2 * 60 * 60 * 1000),
            color: '#336699',
            description: 'Seed session event',
            uuid: ids.plannedObjectUuid,
            entity_name: 'DGCS Intro - Day 1',
            createdAt: now,
            updatedAt: now,
            event_class: 'session_event',
            creator_id: adminId,
        },
    })
}

async function upsertSessionEvent(sessionId: number, plannedObjectId: number) {
    return prisma.claro_cursusbundle_session_event.upsert({
        where: { uuid: ids.sessionEventUuid },
        update: {
            code: 'DGCS-INTRO-EVT-1',
            registration_mail: false,
            planned_object_id: plannedObjectId,
            session_id: sessionId,
        },
        create: {
            session_id: sessionId,
            code: 'DGCS-INTRO-EVT-1',
            registration_type: 0,
            uuid: ids.sessionEventUuid,
            planned_object_id: plannedObjectId,
            registration_mail: false,
        },
    })
}

async function upsertSessionUser(sessionId: number, userId: number) {
    return prisma.claro_cursusbundle_course_session_user.upsert({
        where: { uuid: ids.sessionUserUuid },
        update: {
            session_id: sessionId,
            user_id: userId,
            registration_date: now,
            registration_type: 'seed',
            confirmed: true,
            validated: true,
            status: 1,
            remark: 'Seed inscription',
        },
        create: {
            session_id: sessionId,
            user_id: userId,
            registration_date: now,
            uuid: ids.sessionUserUuid,
            registration_type: 'seed',
            confirmed: true,
            validated: true,
            status: 1,
            remark: 'Seed inscription',
        },
    })
}

async function upsertSessionEventUser(eventId: number, userId: number) {
    return prisma.claro_cursusbundle_session_event_user.upsert({
        where: { uuid: ids.sessionEventUserUuid },
        update: {
            event_id: eventId,
            user_id: userId,
            registration_date: now,
            registration_type: 'seed',
            confirmed: true,
            validated: true,
        },
        create: {
            event_id: eventId,
            user_id: userId,
            registration_date: now,
            uuid: ids.sessionEventUserUuid,
            registration_type: 'seed',
            confirmed: true,
            validated: true,
        },
    })
}

async function upsertCancellation(sessionId: number, userId: number, inscriptionUuid: string) {
    return prisma.claro_cursusbundle_course_session_cancellation.upsert({
        where: { uuid: ids.cancellationUuid },
        update: {
            session_id: sessionId,
            user_id: userId,
            registration_date: now,
            inscription_uuid: inscriptionUuid,
        },
        create: {
            session_id: sessionId,
            user_id: userId,
            registration_date: now,
            uuid: ids.cancellationUuid,
            inscription_uuid: inscriptionUuid,
        },
    })
}

async function seedFormer22Tables(options: {
    clarolineOrgId: number
    clarolineCourseUuid: string
    clarolineSessionUuid: string
    clarolineAdminId: number
    clarolineLearnerId: number
    clarolineLearnerUuid: string
    inscriptionUuid: string
    inscriptionId: number
    sessionId: number
    eventUuid: string
    cancellationId: number
}) {
    const {
        clarolineOrgId,
        clarolineCourseUuid,
        clarolineSessionUuid,
        clarolineAdminId,
        clarolineLearnerId,
        clarolineLearnerUuid,
        inscriptionUuid,
        inscriptionId,
        sessionId,
        eventUuid,
        cancellationId,
    } = options

    const currentYear = new Date().getFullYear()

    await prisma.$executeRaw`
        INSERT INTO former22_organization (
            organizationUuid,
            organizationId,
            billingMode,
            dailyRate,
            flyersCount,
            phone,
            addressTitle,
            postalAddressCountry,
            postalAddressCountryCode,
            postalAddressCode,
            postalAddressStreet,
            postalAddressDepartment,
            postalAddressDepartmentCode,
            postalAddressLocality,
            clientNumber,
            email
        ) VALUES (
            ${ids.organizationUuid},
            ${clarolineOrgId},
            'facturation',
            120.5,
            100,
            '+41000000000',
            'Seed HQ',
            'Switzerland',
            'CH',
            '1000',
            'Seed street 1',
            'Vaud',
            'VD',
            'Lausanne',
            1001,
            'org@example.com'
        )
        ON DUPLICATE KEY UPDATE
            billingMode = VALUES(billingMode),
            dailyRate = VALUES(dailyRate),
            flyersCount = VALUES(flyersCount),
            phone = VALUES(phone),
            addressTitle = VALUES(addressTitle),
            postalAddressCountry = VALUES(postalAddressCountry),
            postalAddressCountryCode = VALUES(postalAddressCountryCode),
            postalAddressCode = VALUES(postalAddressCode),
            postalAddressStreet = VALUES(postalAddressStreet),
            postalAddressDepartment = VALUES(postalAddressDepartment),
            postalAddressDepartmentCode = VALUES(postalAddressDepartmentCode),
            postalAddressLocality = VALUES(postalAddressLocality),
            clientNumber = VALUES(clientNumber),
            email = VALUES(email);
    `

    const [former22Org] = (await prisma.$queryRaw`
        SELECT * FROM former22_organization WHERE organizationUuid = ${ids.organizationUuid}
    `) as any[]

    await prisma.$executeRaw`
        INSERT INTO former22_course (
            courseId,
            coordinator,
            responsible,
            typeStage,
            teachingMethod,
            codeCategory,
            theme,
            targetAudience,
            billingMode,
            pricingType,
            baseRate,
            isRecurrent
        ) VALUES (
            ${clarolineCourseUuid},
            'Admin Trainer',
            'Admin Trainer',
            'Presentiel',
            'Cours',
            'CAT',
            'DGCS',
            'Seed learners',
            'facturation',
            'standard',
            1200,
            false
        )
        ON DUPLICATE KEY UPDATE
            coordinator = VALUES(coordinator),
            responsible = VALUES(responsible),
            typeStage = VALUES(typeStage),
            teachingMethod = VALUES(teachingMethod),
            codeCategory = VALUES(codeCategory),
            theme = VALUES(theme),
            targetAudience = VALUES(targetAudience),
            billingMode = VALUES(billingMode),
            pricingType = VALUES(pricingType),
            baseRate = VALUES(baseRate),
            isRecurrent = VALUES(isRecurrent);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_session (
            sessionId,
            sessionName,
            startDate,
            areInvitesSent,
            sessionFormat,
            sessionLocation
        ) VALUES (
            ${clarolineSessionUuid},
            'DGCS Intro - Spring',
            ${now.toISOString()},
            true,
            'Presentiel',
            'Seed campus'
        )
        ON DUPLICATE KEY UPDATE
            sessionName = VALUES(sessionName),
            startDate = VALUES(startDate),
            areInvitesSent = VALUES(areInvitesSent),
            sessionFormat = VALUES(sessionFormat),
            sessionLocation = VALUES(sessionLocation);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_user (
            userId,
            shouldReceiveSms,
            colorCode
        ) VALUES (
            ${clarolineLearnerUuid},
            true,
            '#1E88E5'
        )
        ON DUPLICATE KEY UPDATE
            shouldReceiveSms = VALUES(shouldReceiveSms),
            colorCode = VALUES(colorCode);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_attestation (
            uuid,
            title,
            description,
            fileStoredName,
            fileOriginalName
        ) VALUES (
            ${ids.attestationUuid},
            'Attestation de participation',
            'Modele de base pour les attestations',
            'seed-attestation.docx',
            'attestation-modele.docx'
        )
        ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            description = VALUES(description),
            fileStoredName = VALUES(fileStoredName),
            fileOriginalName = VALUES(fileOriginalName);
    `

    const [attestation] = (await prisma.$queryRaw`
        SELECT * FROM former22_attestation WHERE uuid = ${ids.attestationUuid}
    `) as any[]

    await prisma.$executeRaw`
        INSERT INTO former22_inscription (
            inscriptionId,
            inscriptionStatus,
            updatedAt,
            attestationId,
            organizationId,
            remark
        ) VALUES (
            ${inscriptionUuid},
            'confirmed',
            ${now},
            ${attestation?.id ?? null},
            ${former22Org?.id ?? null},
            'Inscription seed data'
        )
        ON DUPLICATE KEY UPDATE
            inscriptionStatus = VALUES(inscriptionStatus),
            updatedAt = VALUES(updatedAt),
            attestationId = VALUES(attestationId),
            organizationId = VALUES(organizationId),
            remark = VALUES(remark);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_event (
            eventId,
            isFeesPaid,
            fees
        ) VALUES (
            ${eventUuid},
            false,
            0
        )
        ON DUPLICATE KEY UPDATE
            isFeesPaid = VALUES(isFeesPaid),
            fees = VALUES(fees);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_template (
            templateId,
            title,
            descriptionText,
            emailSubject,
            smsBody,
            emailBody,
            statuses,
            isUsedForSessionInvites
        ) VALUES (
            ${ids.templateId},
            'Modele invitation',
            'Invitation par defaut',
            'Invitation a une session',
            'Bonjour, merci de confirmer votre presence.',
            '<p>Bonjour,<br/>Merci de confirmer votre presence.</p>',
            'confirmed|pending',
            true
        )
        ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            descriptionText = VALUES(descriptionText),
            emailSubject = VALUES(emailSubject),
            smsBody = VALUES(smsBody),
            emailBody = VALUES(emailBody),
            statuses = VALUES(statuses),
            isUsedForSessionInvites = VALUES(isUsedForSessionInvites);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_contract_template (
            uuid,
            title,
            description
        ) VALUES (
            ${ids.contractTemplateUuid},
            'Modele de contrat',
            'Contrat standard'
        )
        ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            description = VALUES(description);
    `

    const [contractTemplate] = (await prisma.$queryRaw`
        SELECT * FROM former22_contract_template WHERE uuid = ${ids.contractTemplateUuid}
    `) as any[]

    await prisma.$executeRaw`
        INSERT INTO former22_contract (
            uuid,
            userId,
            courseId,
            templateId,
            year
        ) VALUES (
            ${ids.contractUuid},
            ${clarolineLearnerUuid},
            ${clarolineCourseUuid},
            ${contractTemplate?.id ?? null},
            ${currentYear}
        )
        ON DUPLICATE KEY UPDATE
            userId = VALUES(userId),
            courseId = VALUES(courseId),
            templateId = VALUES(templateId),
            year = VALUES(year);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_evaluation_template (
            uuid,
            title,
            description,
            struct
        ) VALUES (
            ${ids.evaluationTemplateUuid},
            'Evaluation standard',
            'Formulaire d evaluation de base',
            '{"questions":[{"label":"Satisfaction","type":"number","max":5}]}'
        )
        ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            description = VALUES(description),
            struct = VALUES(struct);
    `

    const [evaluationTemplate] = (await prisma.$queryRaw`
        SELECT * FROM former22_evaluation_template WHERE uuid = ${ids.evaluationTemplateUuid}
    `) as any[]

    await prisma.$executeRaw`
        INSERT INTO former22_evaluation (
            uuid,
            sessionId,
            templateId
        ) VALUES (
            ${ids.evaluationUuid},
            ${sessionId},
            ${evaluationTemplate?.id ?? null}
        )
        ON DUPLICATE KEY UPDATE
            templateId = VALUES(templateId);
    `

    const [evaluation] = (await prisma.$queryRaw`
        SELECT * FROM former22_evaluation WHERE uuid = ${ids.evaluationUuid}
    `) as any[]

    await prisma.$executeRaw`
        INSERT INTO former22_evaluation_result (
            uuid,
            evaluationId,
            result
        ) VALUES (
            ${ids.evaluationResultUuid},
            ${evaluation?.id ?? null},
            '{"Satisfaction":5}'
        )
        ON DUPLICATE KEY UPDATE
            result = VALUES(result);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_auth_codes (
            email,
            code,
            sendTimestamp
        ) VALUES (
            ${ids.authEmail},
            '123456',
            ${Date.now()}
        )
        ON DUPLICATE KEY UPDATE
            code = VALUES(code),
            sendTimestamp = VALUES(sendTimestamp);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_error_report (
            errorId,
            errorDescription,
            errorDate
        ) VALUES (
            ${ids.errorId},
            'Sample error for testing',
            ${now.toISOString()}
        )
        ON DUPLICATE KEY UPDATE
            errorDescription = VALUES(errorDescription),
            errorDate = VALUES(errorDate);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_log (
            logId,
            dateAndTime,
            userEmail,
            entityType,
            entityName,
            entityId,
            actionStatus,
            actionName
        ) VALUES (
            'log-seed-1',
            ${now},
            'admin@example.com',
            'course',
            'Introduction to DGCS',
            ${clarolineCourseUuid},
            'success',
            'Seed data creation'
        )
        ON DUPLICATE KEY UPDATE
            dateAndTime = VALUES(dateAndTime),
            userEmail = VALUES(userEmail),
            entityType = VALUES(entityType),
            entityName = VALUES(entityName),
            entityId = VALUES(entityId),
            actionStatus = VALUES(actionStatus),
            actionName = VALUES(actionName);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_invoice (
            invoiceId,
            inscriptionId,
            participantName,
            tutorsNames,
            courseName,
            sessionName,
            createdAt,
            seances,
            inscriptionStatus
        ) VALUES (
            ${ids.invoiceUuid},
            ${inscriptionId},
            'Learner Seed',
            'Admin Trainer',
            'Introduction to DGCS',
            'Session 1',
            ${now},
            'Day1|Day2',
            'confirmed'
        )
        ON DUPLICATE KEY UPDATE
            participantName = VALUES(participantName),
            tutorsNames = VALUES(tutorsNames),
            courseName = VALUES(courseName),
            sessionName = VALUES(sessionName),
            createdAt = VALUES(createdAt),
            seances = VALUES(seances),
            inscriptionStatus = VALUES(inscriptionStatus);
    `

    await prisma.$executeRaw`
        INSERT INTO former22_manual_invoice (
            uuid,
            organizationId,
            creatorUserId,
            invoiceNumberForCurrentYear,
            customClientEmail,
            customClientAddress,
            invoiceDate,
            courseYear,
            status,
            invoiceType,
            reason,
            selectedUserId,
            customClientTitle,
            customClientFirstname,
            customClientLastname,
            codeCompta
        ) VALUES (
            ${ids.manualInvoiceUuid},
            ${clarolineOrgId},
            ${clarolineAdminId},
            1,
            'client@example.com',
            'Seed street 1, 1000 Lausanne',
            ${now},
            ${currentYear},
            'A traiter',
            'Manuelle',
            'Participation',
            ${clarolineLearnerId},
            'M.',
            'John',
            'Doe',
            'A1-001'
        )
        ON DUPLICATE KEY UPDATE
            organizationId = VALUES(organizationId),
            creatorUserId = VALUES(creatorUserId),
            invoiceNumberForCurrentYear = VALUES(invoiceNumberForCurrentYear),
            customClientEmail = VALUES(customClientEmail),
            customClientAddress = VALUES(customClientAddress),
            invoiceDate = VALUES(invoiceDate),
            courseYear = VALUES(courseYear),
            status = VALUES(status),
            invoiceType = VALUES(invoiceType),
            reason = VALUES(reason),
            selectedUserId = VALUES(selectedUserId),
            customClientTitle = VALUES(customClientTitle),
            customClientFirstname = VALUES(customClientFirstname),
            customClientLastname = VALUES(customClientLastname),
            codeCompta = VALUES(codeCompta);
    `

    const [manualInvoice] = (await prisma.$queryRaw`
        SELECT * FROM former22_manual_invoice WHERE uuid = ${ids.manualInvoiceUuid}
    `) as any[]

    await prisma.$executeRaw`
        INSERT INTO former22_invoice_item (
            uuid,
            invoiceId,
            designation,
            unit,
            amount,
            price,
            vatCode,
            number,
            inscriptionId,
            cancellationId
        ) VALUES (
            ${ids.invoiceItemUuid},
            ${manualInvoice?.id ?? null},
            'Frais de participation',
            'Unite',
            '1',
            '600',
            'TVA-0',
            '001',
            ${inscriptionId},
            ${cancellationId}
        )
        ON DUPLICATE KEY UPDATE
            designation = VALUES(designation),
            unit = VALUES(unit),
            amount = VALUES(amount),
            price = VALUES(price),
            vatCode = VALUES(vatCode),
            number = VALUES(number),
            inscriptionId = VALUES(inscriptionId),
            cancellationId = VALUES(cancellationId);
    `
}

async function main() {
    const organization = await upsertOrganization()
    const adminUser = await upsertUser({
        uuid: ids.adminUuid,
        firstName: 'Admin',
        lastName: 'Trainer',
        username: 'admin.trainer',
        mail: 'admin.trainer@example.com',
    })
    const learnerUser = await upsertUser({
        uuid: ids.learnerUuid,
        firstName: 'Learner',
        lastName: 'Seed',
        username: 'learner.seed',
        mail: 'learner.seed@example.com',
    })

    const course = await upsertCourse(adminUser.id)
    const session = await upsertSession(course.id, adminUser.id)
    const plannedObject = await upsertPlannedObject(adminUser.id)
    const sessionEvent = await upsertSessionEvent(session.id, plannedObject.id)
    const sessionUser = await upsertSessionUser(session.id, learnerUser.id)
    await upsertSessionEventUser(sessionEvent.id, learnerUser.id)
    const cancellation = await upsertCancellation(session.id, learnerUser.id, sessionUser.uuid)

    await seedFormer22Tables({
        clarolineOrgId: organization.id,
        clarolineCourseUuid: course.uuid,
        clarolineSessionUuid: session.uuid,
        clarolineAdminId: adminUser.id,
        clarolineLearnerId: learnerUser.id,
        clarolineLearnerUuid: learnerUser.uuid,
        inscriptionUuid: sessionUser.uuid,
        inscriptionId: sessionUser.id,
        sessionId: session.id,
        eventUuid: sessionEvent.uuid,
        cancellationId: cancellation.id,
    })

    console.log('Seed data created.')
    console.log({
        organization: organization.uuid,
        adminUser: adminUser.uuid,
        learnerUser: learnerUser.uuid,
        course: course.uuid,
        session: session.uuid,
        event: sessionEvent.uuid,
        inscription: sessionUser.uuid,
    })
}

main()
    .catch((error) => {
        console.error('Error while seeding database', error)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
