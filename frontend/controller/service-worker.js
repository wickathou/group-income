'use strict'

import sbp from '@sbp/sbp'
import { handleFetchResult } from './utils/misc.js'
import { requestNotificationPermission } from '@model/contracts/shared/nativeNotification.js'

// NOTE: this file is currently unused. I messed around with it just enough
// to get it working at the most primitive level and decide that I need to
// move on before returning to it. Once it's ready to be added to the app,
// we'll import this file in main.js and call the setup selector there.

sbp('sbp/selectors/register', {
  'service-workers/setup': async function () {
    // setup service worker
    // TODO: move ahead with encryption stuff ignoring this service worker stuff for now
    // TODO: improve updating the sw: https://stackoverflow.com/a/49748437
    // NOTE: user should still be able to use app even if all the SW stuff fails
    if (!('serviceWorker' in navigator)) { return }

    try {
      const registration = await navigator.serviceWorker.register('/assets/js/sw-primary.js', {
        scope: '/'
      })

      if (Notification.permission !== 'granted') {
        await requestNotificationPermission(true)
      }

      const API_URL = sbp('okTurtles.data/get', 'API_URL')

      // if there is an existing subscription, no need to create a new one but make sure the server stores it too.
      const existingSubscription = await registration.pushManager.getSubscription()
      if (existingSubscription) {
        await fetch(`${API_URL}/push/subscribe`, { method: 'POST', body: JSON.stringify(existingSubscription.toJSON()) })
        return
      }

      // get VAPIDPublicKey from the server

      const PUBLIC_VAPID_KEY = await fetch(`${API_URL}/push/publickey`)
        .then(handleFetchResult('text'))

      // create push subscription
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
      })

      // send the subscription details to the server
      await fetch(`${API_URL}/push/subscribe`, { method: 'POST', body: JSON.stringify(subscription.toJSON()) })

      // Send a test notification that tells that push notification is available via the app now.
      // (Just a demonstration purpose and to be removed when not in development)
      const testNotification = {
        title: 'Service worker installed.',
        body: 'You can now receive various push notifications from the Group Income app!'
      }

      await fetch(`${API_URL}/push/send`, { method: 'POST', body: JSON.stringify(testNotification) })
    } catch (e) {
      console.error('error setting up service worker:', e)
    }
  },
  'service-worker/send-push': async function (payload) {
    console.log('@@@ service-worker/send-push is called!!')
    if (!('serviceWorker' in navigator)) { return }

    const swRegistration = await navigator.serviceWorker.ready

    if (!swRegistration) {
      console.error('No service-worker registration found!')
      return
    }

    const pushSubscription = await swRegistration.pushManager.getSubscription()

    if (pushSubscription) {
      const API_URL = sbp('okTurtles.data/get', 'API_URL')

      await fetch(
        `${API_URL}/push/send`,
        { method: 'POST', body: JSON.stringify({ ...payload, endpoint: pushSubscription.endpoint }) }
      )
    } else {
      console.error('No existing subscription found!')
    }
  }
})

// helper method

function urlBase64ToUint8Array (base64String) {
  // reference: https://gist.github.com/Klerith/80abd742d726dd587f4bd5d6a0ab26b6
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
