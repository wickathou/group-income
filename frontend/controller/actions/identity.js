'use strict'

import sbp from '@sbp/sbp'
// Using relative path to crypto.js instead of ~-path to workaround some esbuild bug
import { CURVE25519XSALSA20POLY1305, EDWARDS25519SHA512BATCH, keyId, keygen, deriveKeyFromPassword, deserializeKey, serializeKey, encrypt } from '../../../shared/domains/chelonia/crypto.js'
import { GIErrorUIRuntimeError, L, LError } from '@common/common.js'
import { imageUpload } from '@utils/image.js'
import { pickWhere, difference, uniq } from '@model/contracts/shared/giLodash.js'
import { SETTING_CURRENT_USER } from '~/frontend/model/database.js'
import { LOGIN, LOGOUT } from '~/frontend/utils/events.js'
import { encryptedAction } from './utils.js'
import { handleFetchResult } from '../utils/misc.js'
import { GIMessage } from '~/shared/domains/chelonia/GIMessage.js'
import type { GIKey } from '~/shared/domains/chelonia/GIMessage.js'
import { boxKeyPair, buildRegisterSaltRequest, computeCAndHc, decryptContractSalt, hash, hashPassword, randomNonce } from '~/shared/zkpp.js'

function generatedLoginState () {
  const { contracts } = sbp('state/vuex/state')
  return {
    groupIds: Object.keys(pickWhere(contracts, ({ type }) => {
      return type === 'gi.contracts/group'
    }))
  }
}

function diffLoginStates (s1: ?Object, s2: ?Object) {
  if (typeof s1 !== 'object' || typeof s2 !== 'object') return true
  const [g1, g2] = [(s1: Object).groupIds, (s2: Object).groupIds]
  if (!g1 || !g2) return true
  return (g1.length > g2.length ? difference(g1, g2) : difference(g2, g1)).length > 0
}

export default (sbp('sbp/selectors/register', {
  'gi.actions/identity/retrieveSalt': async (username: string, password: string) => {
    const r = randomNonce()
    const b = hash(r)
    const authHash = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/user=${encodeURIComponent(username)}/auth_hash?b=${encodeURIComponent(b)}`)
      .then(handleFetchResult('json'))

    const { authSalt, s, sig } = authHash

    const h = await hashPassword(password, authSalt)

    const [c, hc] = computeCAndHc(r, s, h)

    const contractHash = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/user=${encodeURIComponent(username)}/contract_hash?${(new URLSearchParams({
      'r': r,
      's': s,
      'sig': sig,
      'hc': Buffer.from(hc).toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=*$/, '')
    })).toString()}`).then(handleFetchResult('text'))

    return decryptContractSalt(c, contractHash)
  },
  'gi.actions/identity/create': async function ({
    data: { username, email, password, picture },
    publishOptions
  }) {
    // TODO: make sure we namespace these names:
    //       https://github.com/okTurtles/group-income/issues/598
    const oldSettings = await sbp('gi.db/settings/load', username)
    if (oldSettings) {
      // TODO: prompt to ask user before deleting and overwriting an existing user
      //       https://github.com/okTurtles/group-income/issues/599
      console.warn(`deleting settings for pre-existing identity ${username}!`, oldSettings)
      await sbp('gi.db/settings/delete', username)
    }

    let finalPicture = `${window.location.origin}/assets/images/user-avatar-default.png`

    if (picture) {
      try {
        finalPicture = await imageUpload(picture)
      } catch (e) {
        console.error('actions/identity.js picture upload error:', e)
        throw new GIErrorUIRuntimeError(L('Failed to upload the profile picture. {codeError}', { codeError: e.message }))
      }
    }
    // proceed with creation
    // first create the mailbox for the user and subscribe to it
    // and do this outside of a try block so that if it throws the error just gets passed up
    const mailbox = await sbp('gi.actions/mailbox/create', {
      data: { username },
      options: { sync: true }
    })
    const mailboxID = mailbox.contractID()

    const keyPair = boxKeyPair()
    const r = Buffer.from(keyPair.publicKey).toString('base64').replace(/\//g, '_').replace(/\+/g, '-')
    const b = hash(r)
    // TODO: use the contractID instead, and move this code down below the registration
    const registrationRes = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/register/user=${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: `b=${encodeURIComponent(b)}`
    })
      .then(handleFetchResult('json'))

    const { p, s, sig } = registrationRes

    const [contractSalt, Eh] = await buildRegisterSaltRequest(p, keyPair.secretKey, password)
    // TODO: use the contractID instead, and move this code down below the registration
    const res = await fetch(`${sbp('okTurtles.data/get', 'API_URL')}/zkpp/register/user=${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'r': r,
        's': s,
        'sig': sig,
        'Eh': Eh
      })
    })

    if (!res.ok) {
      throw new Error('Unable to register hash')
    }

    // Create the necessary keys to initialise the contract
    const IPK = await deriveKeyFromPassword(EDWARDS25519SHA512BATCH, password, contractSalt)
    const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, contractSalt)
    const CSK = keygen(EDWARDS25519SHA512BATCH)
    const CEK = keygen(CURVE25519XSALSA20POLY1305)

    // Key IDs
    const IPKid = keyId(IPK)
    const IEKid = keyId(IEK)
    const CSKid = keyId(CSK)
    const CEKid = keyId(CEK)

    // Public keys to be stored in the contract
    const IPKp = serializeKey(IPK, false)
    const IEKp = serializeKey(IEK, false)
    const CSKp = serializeKey(CSK, false)
    const CEKp = serializeKey(CEK, false)

    // Secret keys to be stored encrypted in the contract
    const CSKs = encrypt(IEK, serializeKey(CSK, true))
    const CEKs = encrypt(IEK, serializeKey(CEK, true))

    let userID
    // next create the identity contract itself and associate it with the mailbox
    try {
      await sbp('chelonia/configure', {
        transientSecretKeys: {
          [IPKid]: IPK,
          [IEKid]: IEK,
          [CSKid]: CSK,
          [CEKid]: CEK
        }
      })

      const user = await sbp('chelonia/out/registerContract', {
        contractName: 'gi.contracts/identity',
        publishOptions,
        signingKeyId: IPKid,
        actionSigningKeyId: CSKid,
        actionEncryptionKeyId: CEKid,
        keys: [
          {
            id: IPKid,
            type: IPK.type,
            data: IPKp,
            permissions: [GIMessage.OP_CONTRACT, GIMessage.OP_KEY_ADD, GIMessage.OP_KEY_DEL],
            meta: {
              type: 'ipk'
            }
          },
          {
            id: IEKid,
            type: IEK.type,
            data: IEKp,
            permissions: ['gi.contracts/identity/keymeta'],
            meta: {
              type: 'iek'
            }
          },
          {
            id: CSKid,
            type: CSK.type,
            data: CSKp,
            permissions: [GIMessage.OP_ACTION_UNENCRYPTED, GIMessage.OP_ACTION_ENCRYPTED, GIMessage.OP_ATOMIC, GIMessage.OP_CONTRACT_AUTH, GIMessage.OP_CONTRACT_DEAUTH, GIMessage.OP_KEYSHARE],
            meta: {
              type: 'csk',
              private: {
                keyId: IEKid,
                content: CSKs
              }
            }
          },
          {
            id: CEKid,
            type: CEK.type,
            data: CEKp,
            permissions: [GIMessage.OP_ACTION_ENCRYPTED, GIMessage.OP_KEYSHARE],
            meta: {
              type: 'cek',
              private: {
                keyId: IEKid,
                content: CEKs
              }
            }
          }
        ],
        data: {
          attributes: { username, email, picture: finalPicture, mailbox: mailboxID }
        }
      })

      userID = user.contractID()

      await sbp('chelonia/contract/sync', userID)
    } catch (e) {
      console.error('gi.actions/identity/create failed!', e)
      throw new GIErrorUIRuntimeError(L('Failed to create user identity: {reportError}', LError(e)))
    }
    return [userID, mailboxID]
  },
  'gi.actions/identity/shareKeysWithSelf': async function ({ userID, contractID }) {
    if (userID === contractID) {
      return
    }

    const contractState = await sbp('chelonia/latestContractState', contractID)

    if (contractState?._volatile?.keys) {
      const state = await sbp('chelonia/latestContractState', userID)

      const CEKid = (((Object.values(Object(state?._vm?.authorizedKeys)): any): GIKey[]).find((k) => k?.meta?.type === 'cek')?.id: ?string)
      const CSKid = (((Object.values(Object(state?._vm?.authorizedKeys)): any): GIKey[]).find((k) => k?.meta?.type === 'csk')?.id: ?string)
      const CEK = deserializeKey(state?._volatile?.keys?.[CEKid])

      await sbp('chelonia/out/keyShare', {
        destinationContractID: userID,
        destinationContractName: 'gi.contracts/identity',
        data: {
          contractID: contractID,
          keys: Object.entries(contractState._volatile.keys).map(([keyId, key]: [string, mixed]) => ({
            id: keyId,
            meta: {
              private: {
                keyId: CEKid,
                content: encrypt(CEK, (key: any))
              }
            }
          }))
        },
        signingKeyId: CSKid
      })
    }
  },
  'gi.actions/identity/signup': async function ({ username, email, password }, publishOptions) {
    try {
      const randomAvatar = sbp('gi.utils/avatar/create')
      const [userID, mailboxID] = await sbp('gi.actions/identity/create', {
        data: {
          username,
          email,
          password,
          picture: randomAvatar
        },
        publishOptions
      })
      await sbp('namespace/register', username, userID)
      return [userID, mailboxID]
    } catch (e) {
      await sbp('gi.actions/identity/logout') // TODO: should this be here?
      console.error('gi.actions/identity/signup failed!', e)
      const message = LError(e)
      if (e.name === 'GIErrorUIRuntimeError') {
        // 'gi.actions/identity/create' also sets reportError
        message.reportError = e.message
      }
      throw new GIErrorUIRuntimeError(L('Failed to signup: {reportError}', message))
    }
  },
  'gi.actions/identity/saveOurLoginState': function () {
    const getters = sbp('state/vuex/getters')
    const contractID = getters.ourIdentityContractId
    const ourLoginState = generatedLoginState()
    const contractLoginState = getters.loginState
    if (contractID && diffLoginStates(ourLoginState, contractLoginState)) {
      return sbp('gi.contracts/identity/setLoginState', {
        contractID, data: ourLoginState
      })
    }
  },
  'gi.actions/identity/updateLoginStateUponLogin': async function () {
    const getters = sbp('state/vuex/getters')
    const state = sbp('state/vuex/state')
    const ourLoginState = generatedLoginState()
    const contractLoginState = getters.loginState
    const { mailbox } = getters.currentIdentityState.attributes
    if (mailbox && !Object.keys(state.contracts).includes(mailbox)) {
      await sbp('chelonia/contract/sync', mailbox)
    }
    try {
      if (!contractLoginState) {
        console.info('no login state detected in identity contract, will set it')
        await sbp('gi.actions/identity/saveOurLoginState')
      } else if (diffLoginStates(ourLoginState, contractLoginState)) {
        // we need to update ourselves to it
        // mainly we are only interested if the contractLoginState contains groupIds
        // that we don't have, and if so, join those groups
        const groupsJoined = difference(contractLoginState.groupIds, ourLoginState.groupIds)
        console.info('synchronizing login state:', { groupsJoined })
        for (const contractID of groupsJoined) {
          try {
            await sbp('gi.actions/group/join', { contractID, options: { skipInviteAccept: true } })
          } catch (e) {
            console.error(`updateLoginStateUponLogin: ${e.name} attempting to join group ${contractID}`, e)
            if (state.contracts[contractID] || state[contractID]) {
              console.warn(`updateLoginStateUponLogin: removing ${contractID} b/c of failed join`)
              try {
                await sbp('chelonia/contract/remove', contractID)
              } catch (e2) {
                console.error(`failed to remove ${contractID} too!`, e2)
              }
            }
          }
        }
      }
      // NOTE: should sync all the identity contracts which are not part of same group
      // but from the direct messages invited by another
      const chatRoomUsers = uniq(Object.keys(
        pickWhere(state.contracts, ({ type }) => type === 'gi.contracts/chatroom')
      ).map(cID => Object.keys(state[cID].users)).flat())
      const additionalIdentityContractIDs = await Promise.all(chatRoomUsers.filter(username => {
        return getters.ourUsername !== username && !getters.ourContacts.includes(username)
      }).map(username => sbp('namespace/lookup', username)))

      for (const identityContractID of additionalIdentityContractIDs) {
        await sbp('chelonia/contract/sync', identityContractID)
      }

      // NOTE: leaving groups will happen when we sync the removeOurselves message
      if (!state.currentGroupId) {
        const { contracts } = state
        const gId = Object.keys(contracts).find(cID => contracts[cID].type === 'gi.contracts/group')
        if (gId) {
          sbp('gi.actions/group/switch', gId)
          const router = sbp('controller/router')
          // redirect us to the dashboard upon login if there's nothing else going on, no modals up, etc.
          // only update the URL if it's empty and we're stuck at the homepage, as can sometimes happen
          if (router.currentRoute.path === '/' && Object.keys(router.currentRoute.query).length === 0) {
            router.push({ path: '/dashboard' }).catch(console.warn)
          }
        }
      } else {
        // We call updateLastLoggedIn in this else clause, instead of outside of it because
        // in the `if` above, updateLastLoggedIn will get called by 'gi.actions/group/switch'
        sbp('gi.actions/group/updateLastLoggedIn', { contractID: state.currentGroupId })
      }
    } catch (e) {
      console.error(`updateLoginState: ${e.name}: '${e.message}'`, e)
    }
  },
  'gi.actions/identity/login': async function ({ username, password }: {
    username: string, password: ?string
  }) {
    // TODO: Insert cryptography here
    const identityContractID = await sbp('namespace/lookup', username)

    if (!identityContractID) {
      throw new GIErrorUIRuntimeError(L('Invalid username or password'))
    }

    const transientSecretKeys = password
      ? await (async () => {
        const salt = await sbp('gi.actions/identity/retrieveSalt', username, password)
        const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, salt)
        const IEKid = keyId(IEK)

        return { [IEKid]: IEK }
      })()
      : {}

    try {
      sbp('appLogs/startCapture', username)
      const state = await sbp('gi.db/settings/load', username)
      let contractIDs = []
      // login can be called when no settings are saved (e.g. from Signup.vue)
      if (state) {
        // The retrieved local data might need to be completed in case it was originally saved
        // under an older version of the app where fewer/other Vuex modules were implemented.
        sbp('state/vuex/postUpgradeVerification', state)
        sbp('state/vuex/replace', state)
        sbp('chelonia/pubsub/update') // resubscribe to contracts since we replaced the state
        contractIDs = Object.keys(state.contracts)
      }
      if (!contractIDs.includes(identityContractID)) {
        contractIDs.push(identityContractID)
      }
      await sbp('gi.db/settings/save', SETTING_CURRENT_USER, username)
      sbp('state/vuex/commit', 'login', { username, identityContractID })
      await sbp('chelonia/configure', { transientSecretKeys })
      // IMPORTANT: we avoid using 'await' on the syncs so that Vue.js can proceed
      //            loading the website instead of stalling out.
      sbp('chelonia/contract/sync', contractIDs).then(async function () {
        // contract sync might've triggered an async call to /remove, so wait before proceeding
        await sbp('chelonia/contract/wait', contractIDs)
        // similarly, since removeMember may have triggered saveOurLoginState asynchronously,
        // we must re-sync our identity contract again to ensure we don't rejoin a group we
        // were just kicked out of
        await sbp('chelonia/contract/sync', identityContractID)
        await sbp('gi.actions/identity/updateLoginStateUponLogin')
        await sbp('gi.actions/identity/saveOurLoginState') // will only update it if it's different
        sbp('okTurtles.events/emit', LOGIN, { username, identityContractID })
      }).catch((err) => {
        const errMsg = L('Error during login contract sync: {err}', { err: err.message })
        console.error(errMsg, err)
        alert(errMsg)
      })
      return identityContractID
    } catch (e) {
      console.error('gi.actions/identity/login failed!', e)
      const humanErr = L('Failed to login: {reportError}', LError(e))
      alert(humanErr)
      sbp('gi.actions/identity/logout')
      throw new GIErrorUIRuntimeError(humanErr)
    }
  },
  'gi.actions/identity/signupAndLogin': async function ({ username, email, password }) {
    const contractIDs = await sbp('gi.actions/identity/signup', { username, email, password })
    await sbp('gi.actions/identity/login', { username, password })
    return contractIDs
  },
  'gi.actions/identity/logout': async function () {
    const state = sbp('state/vuex/state')
    try {
      // wait for any pending sync operations to finish before saving
      console.info('logging out, waiting for any events to finish...')
      await sbp('chelonia/contract/wait')
      await sbp('state/vuex/save')
      const username = await sbp('gi.db/settings/load', SETTING_CURRENT_USER)
      await sbp('gi.db/settings/save', SETTING_CURRENT_USER, null)
      await sbp('chelonia/contract/remove', Object.keys(state.contracts))
      await sbp('gi.db/settings/delete', username)
      await sbp('chelonia/configure', { transientSecretKeys: null })
      console.info('successfully logged out')
    } catch (e) {
      console.error(`${e.name} during logout: ${e.message}`, e)
    }
    sbp('state/vuex/commit', 'logout')
    sbp('okTurtles.events/emit', LOGOUT)
    sbp('appLogs/pauseCapture', { wipeOut: true }) // clear stored logs to prevent someone else accessing sensitve data
  },
  ...encryptedAction('gi.actions/identity/setAttributes', L('Failed to set profile attributes.')),
  ...encryptedAction('gi.actions/identity/updateSettings', L('Failed to update profile settings.')),
  ...encryptedAction('gi.contracts/identity/setLoginState', L('Failed to set login state.'))
}): string[])
