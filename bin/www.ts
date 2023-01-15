#!/usr/bin/env node
/* eslint-disable prefer-template */

import debugImport from 'debug'
import https from 'https'

import { app } from '../src/index'

const debug = debugImport('server:server')

/**
 * Create HTTP server.
 */

const server = https.createServer(app)

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val: string) {
    const port = parseInt(val, 10)

    if (isNaN(port)) {
        // named pipe
        return val
    }

    if (port >= 0) {
        // port number
        return port
    }

    return false
}

/**
 * Get port from environment and store in Express.
 */

const port = normalizePort(process.env.PORT || '4000')
app.set('port', port)

/**
 * Event listener for HTTP server "error" event.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onError(error: any) {
    if (error.syscall !== 'listen') {
        throw error
    }

    const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port

    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            // eslint-disable-next-line no-console
            console.error(bind + ' requires elevated privileges')
            process.exit(1)
            break
        case 'EADDRINUSE':
            // eslint-disable-next-line no-console
            console.error(bind + ' is already in use')
            process.exit(1)
            break
        default:
            throw error
    }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
    const addr = server.address()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr!.port
    debug('Listening on ' + bind)
}

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.info(`Middleware app listening on port: ${port}`)
})
server.on('error', onError)
server.on('listening', onListening)
