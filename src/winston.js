import { createLogger, transports, format } from 'winston'

// define the custom settings for each transport (file, console)
const options = {
    file: {
        level: 'http',
        filename: './logs/service.log',
        handleExceptions: true,
        json: true,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        prettyPrint: true,
        format: format.simple(),
    },
    console: {
        level: 'debug',
        handleExceptions: true,
        json: false,
        prettyPrint: true,
        format: format.combine(format.colorize(), format.simple()),
    },
}

// instantiate a new Winston Logger with the settings defined above
export const winstonLogger = new createLogger({
    transports: [new transports.File(options.file), new transports.Console(options.console)],
    exitOnError: false, // do not exit on handled exceptions
})
