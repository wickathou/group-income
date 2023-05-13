'use strict'
import sbp from '@sbp/sbp'

// Using relative path to crypto.js instead of ~-path to workaround some esbuild bug
import { CURVE25519XSALSA20POLY1305, EDWARDS25519SHA512BATCH, keyId, keygen, serializeKey, encrypt } from '../../../shared/domains/chelonia/crypto.js'
import { L, GIErrorUIRuntimeError } from '@common/common.js'
import { omit } from '@model/contracts/shared/giLodash.js'
import { encryptedAction } from './utils.js'
import { GIMessage } from '~/shared/domains/chelonia/GIMessage.js'
import type { GIRegParams } from './types.js'
import { ChelErrorUnexpected } from '../../../shared/domains/chelonia/errors.js'

export default (sbp('sbp/selectors/register', {
  'gi.actions/chatroom/create': async function (params: GIRegParams) {
    try {
      // Create the necessary keys to initialise the contract
      // eslint-disable-next-line camelcase
      const CSK = keygen(EDWARDS25519SHA512BATCH)
      const CEK = keygen(CURVE25519XSALSA20POLY1305)

      // Key IDs
      const CSKid = keyId(CSK)
      const CEKid = keyId(CEK)

      // Public keys to be stored in the contract
      const CSKp = serializeKey(CSK, false)
      const CEKp = serializeKey(CEK, false)

      // Secret keys to be stored encrypted in the contract
      const CSKs = encrypt(CEK, serializeKey(CSK, true))
      const CEKs = encrypt(CEK, serializeKey(CEK, true))

      // TODO: REMOVE
      // const rootState = sbp('state/vuex/state')

      const joinKey = params.options?.joinKey

      if (!joinKey) {
        throw new ChelErrorUnexpected('joinKey is required to create a chatroom')
      }

      console.log('Chatroom create', {
        ...omit(params, ['options']), // any 'options' are for this action, not for Chelonia
        signingKeyId: CSKid,
        actionSigningKeyId: CSKid,
        actionEncryptionKeyId: CEKid,
        keys: [
          {
            id: CSKid,
            name: 'csk',
            purpose: ['sig'],
            ringLevel: 1,
            permissions: '*',
            meta: {
              private: {
                keyId: CEKid,
                content: CSKs,
                shareable: true
              }
            },
            data: CSKp
          },
          {
            id: CEKid,
            name: 'cek',
            purpose: ['enc'],
            ringLevel: 1,
            permissions: [GIMessage.OP_ACTION_ENCRYPTED],
            meta: {
              private: {
                keyId: CEKid,
                content: CEKs,
                shareable: true
              }
            },
            data: CEKp
          },
          {
            id: joinKey.id,
            name: '#joinKey-' + joinKey.id,
            purpose: ['sig'],
            ringLevel: Number.MAX_SAFE_INTEGER,
            permissions: [GIMessage.OP_KEY_REQUEST],
            data: joinKey.data
          }
        ],
        contractName: 'gi.contracts/chatroom'
      })

      await sbp('chelonia/configure', {
        transientSecretKeys: {
          [CSKid]: CSK,
          [CEKid]: CEK
        }
      })

      const chatroom = await sbp('chelonia/out/registerContract', {
        ...omit(params, ['options']), // any 'options' are for this action, not for Chelonia
        signingKeyId: CSKid,
        actionSigningKeyId: CSKid,
        actionEncryptionKeyId: CEKid,
        keys: [
          {
            id: CSKid,
            name: 'csk',
            purpose: ['sig'],
            ringLevel: 1,
            permissions: '*',
            meta: {
              private: {
                keyId: CEKid,
                content: CSKs
              }
            },
            data: CSKp
          },
          {
            id: CEKid,
            name: 'cek',
            purpose: ['enc'],
            ringLevel: 1,
            permissions: [GIMessage.OP_ACTION_ENCRYPTED],
            meta: {
              private: {
                keyId: CEKid,
                content: CEKs
              }
            },
            data: CEKp
          },
          {
            id: joinKey.id,
            name: '#joinKey-' + joinKey.id,
            purpose: ['sig'],
            ringLevel: Number.MAX_SAFE_INTEGER,
            type: joinKey.type,
            data: joinKey.data,
            permissions: [GIMessage.OP_KEY_REQUEST]
          }
        ],
        contractName: 'gi.contracts/chatroom'
      })

      const contractID = chatroom.contractID()

      await sbp('chelonia/contract/sync', contractID)

      return chatroom
    } catch (e) {
      console.error('gi.actions/chatroom/register failed!', e)
      throw new GIErrorUIRuntimeError(L('Failed to create chat channel.'))
    }
  },
  ...encryptedAction('gi.actions/chatroom/addMessage', L('Failed to add message.')),
  ...encryptedAction('gi.actions/chatroom/editMessage', L('Failed to edit message.')),
  ...encryptedAction('gi.actions/chatroom/deleteMessage', L('Failed to delete message.')),
  ...encryptedAction('gi.actions/chatroom/makeEmotion', L('Failed to make emotion.')),
  ...encryptedAction('gi.actions/chatroom/join', L('Failed to join chat channel.')),
  ...encryptedAction('gi.actions/chatroom/rename', L('Failed to rename chat channel.')),
  ...encryptedAction('gi.actions/chatroom/changeDescription', L('Failed to change chat channel description.')),
  ...encryptedAction('gi.actions/chatroom/leave', L('Failed to leave chat channel.')),
  ...encryptedAction('gi.actions/chatroom/delete', L('Failed to delete chat channel.'))
}): string[])
