const pushInstance = require('web-push')
const pushSubscriptions: Map<string, any> = new Map()
const giConfig = require('../giconf.json')
const { PUSH_SERVER_ACTION_TYPE, PUSH_NOTIFICATION_TYPE, createMessage } = require('../shared/pubsub.js')

// NOTE: VAPID public/private keys can be generated via 'npx web-push generate-vapid-keys' command.
const publicKey = process.env.VAPID_PUBLIC_KEY || giConfig.VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY || giConfig.VAPID_PRIVATE_KEY
pushInstance.setVapidDetails(
  process.env.VAPID_EMAIL || giConfig.VAPID_EMAIL,
  publicKey,
  privateKey
)

const pushActionhandlers: any = {
  [PUSH_SERVER_ACTION_TYPE.SEND_PUBLIC_KEY] () {
    const socket = this

    socket.send(createMessage(PUSH_NOTIFICATION_TYPE.FROM_SERVER, publicKey))
  },
  [PUSH_SERVER_ACTION_TYPE.STORE_SUBSCRIPTION] () {
    console.log('@@@ push action handler for ', PUSH_SERVER_ACTION_TYPE.STORE_SUBSCRIPTION)
  },
  [PUSH_SERVER_ACTION_TYPE.DELETE_SUBSCRIPTION] () {
    console.log('@@@ push action handler for ', PUSH_SERVER_ACTION_TYPE.DELETE_SUBSCRIPTION)
  },
  [PUSH_SERVER_ACTION_TYPE.SEND_PUSH_NOTIFICATION] () {
    console.log('@@@ push action handler for ', PUSH_SERVER_ACTION_TYPE.SEND_PUSH_NOTIFICATION)
  }
}

export {
  pushInstance,
  pushSubscriptions,
  pushActionhandlers
}
