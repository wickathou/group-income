'use strict'

import sbp from '@sbp/sbp'
import Hapi from '@hapi/hapi'
import initDB from './database.js'
import { GIMessage } from '~/shared/domains/chelonia/GIMessage.js'
import { SERVER_RUNNING } from './events.js'
import { SERVER_INSTANCE, PUBSUB_INSTANCE } from './instance-keys.js'
import {
  createMessage,
  createPushErrorResponse,
  createNotification,
  createServer,
  NOTIFICATION_TYPE,
  REQUEST_TYPE
} from './pubsub.js'
import { pushServerActionhandlers } from './push.js'
import chalk from 'chalk'

const { CONTRACTS_VERSION, GI_VERSION } = process.env

const hapi = new Hapi.Server({
  // debug: false, // <- Hapi v16 was outputing too many unnecessary debug statements
  //               // v17 doesn't seem to do this anymore so I've re-enabled the logging
  debug: { log: ['error'], request: ['error'] },
  port: process.env.API_PORT,
  // See: https://github.com/hapijs/discuss/issues/262#issuecomment-204616831
  routes: {
    cors: {
      // TODO: figure out if we can live with '*' or if we need to restrict it
      origin: ['*']
      // origin: [
      //   process.env.API_URL,
      //   // improve support for browsersync proxy
      //   ...(process.env.NODE_ENV === 'development' && ['http://localhost:3000'])
      // ]
    }
  }
})

// See https://stackoverflow.com/questions/26213255/hapi-set-header-before-sending-response
hapi.ext({
  type: 'onPreResponse',
  method: function (request, h) {
    try {
      // Hapi Boom error responses don't have `.header()`,
      // but custom headers can be manually added using `.output.headers`.
      // See https://hapi.dev/module/boom/api/.
      if (typeof request.response.header === 'function') {
        request.response.header('X-Frame-Options', 'deny')
      } else {
        request.response.output.headers['X-Frame-Options'] = 'deny'
      }
    } catch (err) {
      console.warn(chalk.yellow('[backend] Could not set X-Frame-Options header:', err.message))
    }
    return h.continue
  }
})

sbp('okTurtles.data/set', SERVER_INSTANCE, hapi)

sbp('sbp/selectors/register', {
  'backend/server/broadcastEntry': async function (entry: GIMessage) {
    const pubsub = sbp('okTurtles.data/get', PUBSUB_INSTANCE)
    const pubsubMessage = createMessage(NOTIFICATION_TYPE.ENTRY, entry.serialize())
    const subscribers = pubsub.enumerateSubscribers(entry.contractID())
    console.debug(chalk.blue.bold(`[pubsub] Broadcasting ${entry.description()}`))
    await pubsub.broadcast(pubsubMessage, { to: subscribers })
  },
  'backend/server/handleEntry': async function (entry: GIMessage) {
    sbp('okTurtles.data/get', PUBSUB_INSTANCE).channels.add(entry.contractID())
    await sbp('chelonia/db/addEntry', entry)
    await sbp('backend/server/broadcastEntry', entry)
  },
  'backend/server/stop': function () {
    return hapi.stop()
  }
})

if (process.env.NODE_ENV === 'development' && !process.env.CI) {
  hapi.events.on('response', (request, event, tags) => {
    console.debug(chalk`{grey ${request.info.remoteAddress}: ${request.method.toUpperCase()} ${request.path} --> ${request.response.statusCode}}`)
  })
}

sbp('okTurtles.data/set', PUBSUB_INSTANCE, createServer(hapi.listener, {
  serverHandlers: {
    connection (socket: Object, request: Object) {
      const versionInfo = { GI_VERSION, CONTRACTS_VERSION }
      socket.send(createNotification(NOTIFICATION_TYPE.VERSION_INFO, versionInfo))
    }
  },
  messageHandlers: {
    [REQUEST_TYPE.PUSH_ACTION]: async function ({ data }) {
      const socket = this
      const { action, payload } = data

      if (!action) {
        socket.send(createPushErrorResponse({ message: "'action' field is required" }))
      }

      const handler = pushServerActionhandlers[action]

      if (handler) {
        try {
          await handler.call(socket, payload)
        } catch (error) {
          socket.send(createPushErrorResponse({
            actionType: action,
            message: error?.message || `push server failed to perform [${action}] action`
          }))
        }
      } else {
        socket.send(createPushErrorResponse({ message: `No handler for the '${action}' action` }))
      }
    }
  }
}))

;(async function () {
  // https://hapi.dev/tutorials/plugins
  await hapi.register([
    { plugin: require('./auth.js') },
    { plugin: require('@hapi/inert') }
    // {
    //   plugin: require('hapi-pino'),
    //   options: {
    //     instance: logger
    //   }
    // }
  ])
  await initDB()
  require('./routes.js')
  await hapi.start()
  console.info('Backend server running at:', hapi.info.uri)
  sbp('okTurtles.events/emit', SERVER_RUNNING, hapi)
})()
