import { pick } from '@model/contracts/shared/giLodash.js'
import sbp from '@sbp/sbp'
import type { GIKey } from '~/shared/domains/chelonia/GIMessage.js'
import { encryptedOutgoingData } from '~/shared/domains/chelonia/encryptedData.js'
import { findKeyIdByName, findSuitableSecretKeyId } from '~/shared/domains/chelonia/utils.js'
// Using relative path to crypto.js instead of ~-path to workaround some esbuild bug
import { keyId, keygenOfSameType, serializeKey } from '../../../shared/domains/chelonia/crypto.js'

export { default as chatroom } from './chatroom.js'
export { default as group } from './group.js'
export { default as identity } from './identity.js'

sbp('sbp/selectors/register', {
  // Utility function that covers the common scenario of needing to share some
  // contract's secret keys with another contract. This function emits OP_KEY_SHARE
  // by calling 'chelonia/out/keyShare'.
  // One common use case for this function is sharing keys with ourselves after
  // creating a new contract (for example, when we create a group) or to share
  // keys of a child contract with a parent contract (such as sharing the keys to
  // a chat room with its parent group contract)
  'gi.actions/out/shareVolatileKeys': async ({
    destinationContractID,
    destinationContractName,
    originatingContractID,
    originatingContractName,
    contractID,
    keyIds
  }) => {
    if (destinationContractID === contractID) {
      return
    }

    const contractState = await sbp('chelonia/latestContractState', contractID)

    if (contractState?._volatile?.keys && Object.keys(contractState?._volatile?.keys).length) {
      const state = await sbp('chelonia/latestContractState', destinationContractID)
      const originatingContractState = originatingContractID && originatingContractID !== destinationContractID ? await sbp('chelonia/latestContractState', originatingContractID) : state

      const CEKid = findKeyIdByName(state, 'cek')
      const CSKid = findKeyIdByName(originatingContractState, 'csk')

      if (!state?._vm?.authorizedKeys?.[CEKid]) {
        throw new Error('Missing CEK; unable to proceed sharing keys')
      }

      const keysToShare = Array.isArray(keyIds) ? pick(contractState._volatile.keys, keyIds) : keyIds === '*' ? contractState._volatile.keys : null

      if (!keysToShare) {
        throw new TypeError('Invalid parameter: keyIds')
      }

      await sbp('chelonia/out/keyShare', {
        destinationContractID,
        destinationContractName,
        originatingContractID,
        originatingContractName,
        data: {
          contractID,
          keys: Object.entries(keysToShare).map(([keyId, key]: [string, mixed]) => ({
            id: keyId,
            meta: {
              private: {
                content: encryptedOutgoingData(state, CEKid, key)
              }
            }
          }))
        },
        signingKeyId: CSKid
      })
    }
  },
  'gi.actions/out/rotateKeys': async (
    contractID: string,
    contractName: string,
    keysToRotate: string[] | '*' | 'pending',
    shareNewKeysSelector?: string
  ) => {
    const rootState = sbp('state/vuex/state')
    const state = rootState[contractID]

    let ringLevel = Number.MAX_SAFE_INTEGER

    // $FlowFixMe
    const newKeys = Object.fromEntries(Object.entries(state._vm.authorizedKeys).filter(([id, data]: [string, GIKey]) => {
      return !!data.meta?.private && (
        Array.isArray(keysToRotate)
          ? keysToRotate.includes(data.name)
          : keysToRotate === '*'
            ? true
            // $FlowFixMe
            : state._volatile?.pendingKeyRevocations && Object.prototype.hasOwnProperty.call(state._volatile.pendingKeyRevocations, id))
    }).map(([id, data]: [string, GIKey]) => {
      const newKey = keygenOfSameType(data.data)
      return [data.name, [id, newKey, keyId(newKey), data.meta.private.keyId]]
    }))

    // $FlowFixMe
    const updatedKeys = Object.values(newKeys).map(([id, newKey, newId, eKID]) => {
      const encryptionKeyName = state._vm.authorizedKeys[eKID].name
      // $FlowFixMe
      const encryptionKey = Object.prototype.hasOwnProperty.call(newKeys, encryptionKeyName) ? newKeys[encryptionKeyName][1] : state._vm.authorizedKeys[eKID].data

      if (state._vm.authorizedKeys[id].ringLevel < ringLevel) {
        ringLevel = state._vm.authorizedKeys[id].ringLevel
      }

      return {
        name: state._vm.authorizedKeys[id].name,
        id: newId,
        oldKeyId: id,
        data: serializeKey(newKey, false),
        meta: {
          private: {
            content: encryptedOutgoingData(state, keyId(encryptionKey), serializeKey(newKey, true)),
            shareable: state._vm.authorizedKeys[id].meta.private.shareable
          }
        }
      }
    })

    const signingKeyId = findSuitableSecretKeyId(state, [], ['sig'], ringLevel)

    if (!signingKeyId) {
      throw new Error('No suitable signing key found')
    }

    // Share new keys with other contracts
    if (shareNewKeysSelector) {
      await sbp(shareNewKeysSelector, contractID, newKeys)
    }

    // Issue OP_KEY_UPDATE
    await sbp('chelonia/out/keyUpdate', {
      contractID,
      contractName,
      data: updatedKeys,
      signingKeyId
    })
  }
})
