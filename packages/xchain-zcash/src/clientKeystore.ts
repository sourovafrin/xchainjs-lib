import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs'
import { DEFAULT_CONSENSUS_BRANCH_ID, buildMaxTx, buildTx, signAndFinalize, skToAddr } from '@xchainjs/zcash-js'
import { Network, TxHash, checkFeeBounds } from '@xchainjs/xchain-client'
import { getSeed } from '@xchainjs/xchain-crypto'
import { Address } from '@xchainjs/xchain-util'
import { TxParams, UTXO, UtxoClientParams, UtxoTransactionValidator } from '@xchainjs/xchain-utxo'
import { HDKey } from '@scure/bip32'
import { ECPairFactory, ECPairInterface } from 'ecpair'

import { Client, defaultZECParams } from './client'
import { ZEC_BLOCKBOOK_URL } from './const'
import * as Utils from './utils'

const ECPair = ECPairFactory(ecc)
/**
 * Custom Bitcoin client extended to support keystore functionality
 */
class ClientKeystore extends Client {
  constructor(
    params: UtxoClientParams = {
      ...defaultZECParams,
    },
  ) {
    super(params)
  }
  /**
   * @deprecated This function eventually will be removed. Use getAddressAsync instead.
   * Get the address associated with the given index.
   * @param {number} index The index of the address.
   * @returns {Address} The Bitcoin address.
   * @throws {"index must be greater than zero"} Thrown if the index is less than zero.
   * @throws {"Phrase must be provided"} Thrown if the phrase has not been set before.
   */
  getAddress(index = 0): Address {
    // Check if the index is valid
    if (index < 0) {
      throw new Error('index must be greater than zero')
    }

    // Check if the phrase has been set
    if (this.phrase) {
      const zecKeys = this.getZecKeys(this.phrase, index)
      if (!zecKeys.privateKey) {
        throw Error('Error getting private key')
      }
      const prefix = Utils.zecNetworkPrefix(this.network)
      const prefixUint8Array = new Uint8Array(prefix)
      return skToAddr(zecKeys.privateKey, prefixUint8Array)
    }

    throw new Error('Phrase must be provided')
  }

  /**
   * Get the current address asynchronously.
   * @param {number} index The index of the address.
   * @returns {Promise<Address>} A promise that resolves to the Bitcoin address.
   * @throws {"Phrase must be provided"} Thrown if the phrase has not been set before.
   */
  async getAddressAsync(index = 0): Promise<string> {
    return this.getAddress(index)
  }

  /**
   * @private
   * Get the keys derived from the given phrase.
   *
   * @param {string} phrase The phrase to be used for generating the keys.
   * @param {number} index The index of the address.
   * @returns {Bitcoin.ECPair.ECPairInterface} The Bitcoin key pair.
   * @throws {"Could not get private key from phrase"} Thrown if failed to create BTC keys from the given phrase.
   */
  private getZecKeys(phrase: string, index = 0): ECPairInterface {
    const seed = getSeed(phrase)

    const master = HDKey.fromMasterSeed(seed).derive(this.getFullDerivationPath(index))

    if (!master.privateKey) {
      throw new Error('Could not get private key from phrase')
    }

    return ECPair.fromPrivateKey(Buffer.from(master.privateKey)) // Be carefull missing zcash network due to this error: https://github.com/iancoleman/bip39/issues/94
  }

  /**
   * Get the consensus branch ID that transactions must commit to when signing.
   *
   * Queries the blockbook backend (`backend.consensus.nextblock`) so the value
   * tracks Zcash network upgrades automatically. Falls back to the library's
   * built-in default if the node can't be reached or returns an unexpected shape.
   *
   * @returns {Promise<number>} The consensus branch ID as a 32-bit integer.
   */
  private async getConsensusBranchId(): Promise<number> {
    // Only mainnet/stagenet have a configured provider; testnet uses the default.
    if (this.network === Network.Testnet) return DEFAULT_CONSENSUS_BRANCH_ID
    try {
      const response = await fetch(ZEC_BLOCKBOOK_URL, {
        headers: { 'api-key': process.env.NOWNODES_API_KEY || '' },
      })
      const data = (await response.json()) as { backend?: { consensus?: { nextblock?: string } } }
      const branchHex = data?.backend?.consensus?.nextblock
      if (typeof branchHex === 'string' && /^[0-9a-fA-F]{1,8}$/.test(branchHex)) {
        return parseInt(branchHex, 16)
      }
    } catch {
      // Network/parse error — fall back to the built-in default below.
    }
    return DEFAULT_CONSENSUS_BRANCH_ID
  }

  /**
   * Transfer ZEC.
   *
   * @param {TxParams&FeeRate} params The transfer options including the fee rate.
   * @returns {Promise<TxHash|string>} A promise that resolves to the transaction hash or an error message.
   * @throws {"memo too long"} Thrown if the memo is longer than 80 characters.
   */
  async transfer(params: TxParams & { selectedUtxos?: UTXO[] }): Promise<TxHash> {
    // Get the address index from the parameters or use the default value
    const fromAddressIndex = params?.walletIndex || 0

    const zecKeys = this.getZecKeys(this.phrase, fromAddressIndex)
    const sender = await this.getAddressAsync(fromAddressIndex)

    let utxos: UTXO[]
    if (params.selectedUtxos && params.selectedUtxos.length > 0) {
      UtxoTransactionValidator.validateUtxoSet(params.selectedUtxos)
      utxos = params.selectedUtxos
    } else {
      utxos = await this.scanUTXOs(sender, true)
    }
    if (utxos.length === 0) throw new Error('Insufficient Balance for transaction')

    const zcashUtxos = utxos.map((utxo) => ({
      address: sender,
      txid: utxo.hash,
      outputIndex: utxo.index,
      satoshis: utxo.value,
    }))

    const tx = await buildTx(
      0,
      sender,
      params.recipient,
      params.amount.amount().toNumber(),
      zcashUtxos,
      this.network === Network.Testnet ? false : true,
      params.memo,
    )

    checkFeeBounds(this.feeBounds, tx.fee)

    if (!zecKeys.privateKey) {
      throw Error('Error getting private key')
    }

    const consensusBranchId = await this.getConsensusBranchId()
    const signedBuffer = await signAndFinalize(
      0,
      (zecKeys.privateKey as Buffer).toString('hex'),
      tx.inputs,
      tx.outputs,
      consensusBranchId,
    )

    const txId = await this.roundRobinBroadcastTx(signedBuffer.toString('hex'))

    return txId
  }

  /**
   * Transfer the maximum amount of ZEC (sweep).
   *
   * Calculates the maximum sendable amount after fees, signs, and broadcasts the transaction.
   * Note: Zcash uses flat fees, so feeRate is ignored.
   * @param {Object} params The transfer parameters.
   * @param {string} params.recipient The recipient address.
   * @param {string} [params.memo] Optional memo for the transaction.
   * @param {number} [params.walletIndex] Optional wallet index. Defaults to 0.
   * @returns {Promise<{ hash: TxHash; maxAmount: number; fee: number }>} The transaction hash, amount sent, and fee.
   */
  async transferMax(params: {
    recipient: Address
    memo?: string
    walletIndex?: number
    selectedUtxos?: UTXO[]
  }): Promise<{ hash: TxHash; maxAmount: number; fee: number }> {
    const fromAddressIndex = params.walletIndex || 0
    const sender = await this.getAddressAsync(fromAddressIndex)

    const zecKeys = this.getZecKeys(this.phrase, fromAddressIndex)
    if (!zecKeys.privateKey) {
      throw Error('Error getting private key')
    }

    let utxos: UTXO[]
    if (params.selectedUtxos && params.selectedUtxos.length > 0) {
      UtxoTransactionValidator.validateUtxoSet(params.selectedUtxos)
      utxos = params.selectedUtxos
    } else {
      utxos = await this.scanUTXOs(sender, true)
    }
    if (utxos.length === 0) throw new Error('Insufficient Balance for transaction')

    const zcashUtxos = utxos.map((utxo) => ({
      address: sender,
      txid: utxo.hash,
      outputIndex: utxo.index,
      satoshis: utxo.value,
    }))

    // Use buildMaxTx which creates NO change output (sweep transaction)
    const tx = await buildMaxTx(0, sender, params.recipient, zcashUtxos, this.network !== Network.Testnet, params.memo)

    checkFeeBounds(this.feeBounds, tx.fee)

    const consensusBranchId = await this.getConsensusBranchId()
    const signedBuffer = await signAndFinalize(
      0,
      (zecKeys.privateKey as Buffer).toString('hex'),
      tx.inputs,
      tx.outputs,
      consensusBranchId,
    )
    const hash = await this.roundRobinBroadcastTx(signedBuffer.toString('hex'))

    return { hash, maxAmount: tx.maxAmount, fee: tx.fee }
  }
}

export { ClientKeystore }
