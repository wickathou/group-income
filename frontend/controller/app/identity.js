'use strict'

import { GIErrorUIRuntimeError, L, LError, LTags } from '@common/common.js'
import sbp from '@sbp/sbp'
import { LOGIN, LOGIN_ERROR } from '~/frontend/utils/events.js'
import { Secret } from '~/shared/domains/chelonia/Secret.js'
import { boxKeyPair, buildRegisterSaltRequest, computeCAndHc, decryptContractSalt, hash, hashPassword, randomNonce } from '~/shared/zkpp.js'
// Using relative path to crypto.js instead of ~-path to workaround some esbuild bug
import { CURVE25519XSALSA20POLY1305, EDWARDS25519SHA512BATCH, deriveKeyFromPassword, serializeKey } from '../../../shared/domains/chelonia/crypto.js'
import { handleFetchResult } from '../utils/misc.js'
import { cloneDeep } from '@model/contracts/shared/giLodash.js'

const loadState = async (identityContractID: string, password: ?string) => {
  if (password) {
    const stateKeyEncryptionKeyFn = (stateEncryptionKeyId, salt) => {
      return deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, salt + stateEncryptionKeyId)
    }

    const { encryptionParams, value: state } = await sbp('gi.db/settings/loadEncrypted', identityContractID, stateKeyEncryptionKeyFn)

    if (state) {
      const cheloniaState = state.cheloniaState
      delete state.cheloniaState

      return { encryptionParams, state, cheloniaState }
    } else {
      return { encryptionParams, state }
    }
  } else {
    const state = await sbp('gi.db/settings/load', identityContractID)

    return { state }
  }
}

export default (sbp('sbp/selectors/register', {
  'gi.app/identity/retrieveSalt': async (username: string, password: Secret<string>) => {
    const r = randomNonce()
    const b = hash(r)
    const authHash = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/${encodeURIComponent(username)}/auth_hash?b=${encodeURIComponent(b)}`)
      .then(handleFetchResult('json'))

    const { authSalt, s, sig } = authHash

    const h = await hashPassword(password.valueOf(), authSalt)

    const [c, hc] = computeCAndHc(r, s, h)

    const contractHash = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/${encodeURIComponent(username)}/contract_hash?${(new URLSearchParams({
      'r': r,
      's': s,
      'sig': sig,
      'hc': Buffer.from(hc).toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=*$/, '')
    })).toString()}`).then(handleFetchResult('text'))

    return decryptContractSalt(c, contractHash)
  },
  'gi.app/identity/create': async function ({
    data: { username, email, password, picture },
    publishOptions
  }) {
    password = password.valueOf()

    // proceed with creation
    const keyPair = boxKeyPair()
    const r = Buffer.from(keyPair.publicKey).toString('base64').replace(/\//g, '_').replace(/\+/g, '-')
    const b = hash(r)
    // TODO: use the contractID instead, and move this code down below the registration
    const registrationRes = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/register/${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: `b=${encodeURIComponent(b)}`
    })
      .then(handleFetchResult('json'))

    const { p, s, sig } = registrationRes

    const [contractSalt, Eh] = await buildRegisterSaltRequest(p, keyPair.secretKey, password)

    // Create the necessary keys to initialise the contract
    const IPK = await deriveKeyFromPassword(EDWARDS25519SHA512BATCH, password, contractSalt)
    const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, contractSalt)

    // next create the identity contract itself
    try {
      const userID = await sbp('gi.actions/identity/create', {
        // TODO: Wrap IPK and IEK in "Secret"
        IPK: serializeKey(IPK, true),
        IEK: serializeKey(IEK, true),
        publishOptions,
        username,
        email,
        picture,
        r,
        s,
        sig,
        Eh
      })

      return userID
    } catch (e) {
      console.error('gi.app/identity/create failed!', e)
      throw new GIErrorUIRuntimeError(L('Failed to create user identity: {reportError}', LError(e)))
    }
  },
  'gi.app/identity/signup': async function ({ username, email, password }, publishOptions) {
    try {
      const randomAvatar = sbp('gi.utils/avatar/create')
      const userID = await sbp('gi.app/identity/create', {
        data: {
          username,
          email,
          password,
          picture: randomAvatar
        },
        publishOptions
      })
      return userID
    } catch (e) {
      console.error('gi.app/identity/signup failed!', e)
      await sbp('gi.app/identity/logout') // TODO: should this be here?
      const message = LError(e)
      if (e.name === 'GIErrorUIRuntimeError') {
        // 'gi.app/identity/create' also sets reportError
        message.reportError = e.message
      }
      throw new GIErrorUIRuntimeError(L('Failed to signup: {reportError}', message))
    }
  },
  'gi.app/identity/login': async function ({ username, password: wpassword, identityContractID }: {
    username: ?string, password: ?Secret<string>, identityContractID: ?string
  }) {
    if (username) {
      identityContractID = await sbp('namespace/lookup', username)
    }

    if (!identityContractID) {
      throw new GIErrorUIRuntimeError(L('Incorrect username or password'))
    }

    const password = wpassword?.valueOf()
    const transientSecretKeys = []
    if (password) {
      try {
        const salt = await sbp('gi.app/identity/retrieveSalt', username, wpassword)
        const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, salt)
        transientSecretKeys.push(IEK)
      } catch (e) {
        console.error('caught error calling retrieveSalt:', e)
        throw new GIErrorUIRuntimeError(L('Incorrect username or password'))
      }
    }

    try {
      sbp('appLogs/startCapture', identityContractID)
      const { state, cheloniaState, encryptionParams } = await loadState(identityContractID, password)

      //            loading the website instead of stalling out.
      /* try {
        if (!state) {
          // Make sure we don't unsubscribe from our own identity contract
          // Note that this should be done _after_ calling
          // `chelonia/storeSecretKeys`: If the following line results in
          // syncing the identity contract and fetching events, the secret keys
          // for processing them will not be available otherwise.
          await sbp('chelonia/contract/retain', identityContractID)
        } else {
          // If there is a state, we've already retained the identity contract
          // but might need to fetch the latest events
          await sbp('chelonia/contract/sync', identityContractID, { force: true })
        }
      } catch (err) {
        sbp('okTurtles.events/emit', LOGIN_ERROR, { username, identityContractID, error: err })
        const errMessage = err?.message || String(err)
        console.error('Error during login contract sync', errMessage)

        const promptOptions = {
          heading: L('Login error'),
          question: L('Do you want to log out? Error details: {err}.', { err: err.message }),
          primaryButton: L('No'),
          secondaryButton: L('Yes')
        }

        const result = await sbp('gi.ui/prompt', promptOptions)
        if (!result) {
          return sbp('gi.app/identity/logout')
        } else {
          throw err
        }
      }
      */

      try {
        if (password) {
          // TODO: Wrap transientSecretKeys in Secret<>
          await sbp('gi.actions/identity/login', { identityContractID, encryptionParams, cheloniaState, state, transientSecretKeys: transientSecretKeys.map(k => serializeKey(k, true)) })
        } else {
          sbp('okTurtles.events/emit', LOGIN, { identityContractID, state })
        }
      } catch (e) {
        const errMessage = e?.message || String(e)
        console.error('Error during login contract sync', e)

        const promptOptions = {
          heading: L('Login error'),
          question: L('Do you want to log out? {br_}Error details: {err}.', { err: errMessage, ...LTags() }),
          primaryButton: L('No'),
          secondaryButton: L('Yes')
        }

        const result = await sbp('gi.ui/prompt', promptOptions)
        if (!result) {
          return sbp('gi.app/identity/logout')
        } else {
          sbp('okTurtles.events/emit', LOGIN_ERROR, { username, identityContractID, error: e })
          throw e
        }
      }

      return identityContractID
    } catch (e) {
      console.error('gi.app/identity/login failed!', e)
      const humanErr = L('Failed to login: {reportError}', LError(e))
      alert(humanErr)
      await sbp('gi.app/identity/logout')
        .catch((e) => {
          console.error('[gi.app/identity/login] Error calling logout (after failure to login)', e)
        })
      throw new GIErrorUIRuntimeError(humanErr)
    }
  },
  'gi.app/identity/signupAndLogin': async function ({ username, email, password }) {
    const contractIDs = await sbp('gi.app/identity/signup', { username, email, password })
    await sbp('gi.app/identity/login', { username, password })
    return contractIDs
  },
  'gi.app/identity/logout': async function () {
    try {
      const state = cloneDeep(sbp('state/vuex/state'))
      if (!state.loggedIn) return

      const cheloniaState = await sbp('gi.actions/identity/logout')

      const { encryptionParams } = state.loggedIn
      if (encryptionParams) {
        state.cheloniaState = cheloniaState

        await sbp('state/vuex/save', true, state)
        await sbp('gi.db/settings/deleteStateEncryptionKey', encryptionParams)
      }
    } catch (e) {
      console.error(`${e.name} during logout: ${e.message}`, e)
    }
  }
}))
