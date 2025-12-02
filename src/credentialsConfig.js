// dgcs-dev
// export const clarolineApiUrl = process.env.CLAROLINE_API_URL ?? 'https://www.dgcs-dev.ch/apiv2/'
// dgcs-val
export const clarolineApiUrl = process.env.CLAROLINE_API_URL ?? 'https://www.dgcs-val.ch/apiv2/'
// plain dgcs-val
// export const clarolineApiUrl = process.env.CLAROLINE_API_URL ?? 'https://claroline-val.jcloud.ik-server.com/apiv2/'

export const MIDDLEWARE_URL =
    process.env.MIDDLEWARE_URL ??
    (process.env.NODE_ENV === 'production' ? 'https://middleware.dgcs-val.ch' : 'http://localhost:4000')

export const mailerHostUrl = process.env.MAILER_HOST_URL ?? 'https://postal.dgcs-val.ch'
export const smsSenderUrl = process.env.SMS_SENDER_URL ?? 'https://api.smsup.ch/send/simulate'
export const smsSenderToken = process.env.SMS_SENDER_TOKEN ?? ''
export const mailerApiKey = process.env.MAILER_API_KEY ?? ''
export const mailerApiKeyClaroline = process.env.MAILER_API_KEY_CLAROLINE ?? ''
export const mailerTag = process.env.MAILER_TAG ?? 'former22'
export const mailerFrom = process.env.MAILER_FROM ?? 'no-reply@dgcs-dev.ch'
export const mailgunApiKey = process.env.MAILGUN_API_KEY ?? ''
export const mailgunDomain = process.env.MAILGUN_DOMAIN ?? 'dgcs-dev.ch'
export const mailgunWhitelist =
    process.env.MAILGUN_WHITELIST ??
    '@araspe.ch,@ilavigny.ch,@lerepuis.ch,@polouest.ch,@pragmaticmanagement.ch,@vd.educanet2.ch'

export const useMailhog = process.env.USE_MAILHOG === 'true'
export const mailhogHost = process.env.MAILHOG_HOST ?? '127.0.0.1'
export const mailhogPort = Number(process.env.MAILHOG_PORT ?? '1025')
