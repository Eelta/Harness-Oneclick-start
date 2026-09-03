/** Fail before updates or builds if the configured web address is occupied. */
import { createServer } from 'node:net'

const host = process.env.DSH_WEB_HOST || '127.0.0.1'
const port = Number(process.env.DSH_WEB_PORT || '13080')
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('error: DSH_WEB_PORT must be an integer between 1 and 65535')
  process.exitCode = 1
} else {
  const server = createServer()
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`error: ${host}:${port} is already in use. Harness may already be running.`)
      console.error('Use the existing Harness window, or stop its terminal with Ctrl+C before restarting.')
    } else {
      console.error(`error: cannot listen on ${host}:${port}: ${error.message}`)
    }
    process.exitCode = 1
  })
  server.listen({ host, port, exclusive: true }, () => server.close())
}
