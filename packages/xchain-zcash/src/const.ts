import { ExplorerProvider, Network } from '@xchainjs/xchain-client'
import { Asset, AssetType } from '@xchainjs/xchain-util'
import { NownodesProvider, UtxoOnlineDataProviders } from '@xchainjs/xchain-utxo-providers'

export const MIN_TX_FEE = 10000

export const ZEC_DECIMAL = 8

export const LOWER_FEE_BOUND = 10000
export const UPPER_FEE_BOUND = 100000

/**
 * Chain identifier for Zcash mainnet
 */
export const ZECChain = 'ZEC' as const

/**
 * Base "chain" asset on Zcash main net.
 */
export const AssetZEC: Asset = { chain: ZECChain, symbol: 'ZEC', ticker: 'ZEC', type: AssetType.NATIVE }

// Explorer providers for Zcash
const ZEC_MAINNET_EXPLORER = new ExplorerProvider(
  'https://blockchair.com/zcash/',
  'https://blockchair.com/zcash/address/%%ADDRESS%%',
  'https://blockchair.com/zcash/transaction/%%TX_ID%%',
)
const ZEC_TESTNET_EXPLORER = new ExplorerProvider(
  'https://testnet.zcashexplorer.app/',
  'https://testnet.zcashexplorer.app/address/%%ADDRESS%%',
  'https://testnet.zcashexplorer.app/transactions/%%TX_ID%%',
)
export const zcashExplorerProviders = {
  [Network.Testnet]: ZEC_TESTNET_EXPLORER,
  [Network.Stagenet]: ZEC_MAINNET_EXPLORER,
  [Network.Mainnet]: ZEC_MAINNET_EXPLORER,
}

// Blockbook base URL. Its root (GET /) reports the live consensus branch ID at
// backend.consensus.nextblock, which transactions must commit to when signing.
export const ZEC_BLOCKBOOK_URL = 'https://zecbook.nownodes.io/api/v2'

const mainnetNownodesProvider = new NownodesProvider(
  ZEC_BLOCKBOOK_URL,
  ZECChain,
  AssetZEC,
  ZEC_DECIMAL,
  process.env.NOWNODES_API_KEY || '',
)

export const NownodesProviders: UtxoOnlineDataProviders = {
  [Network.Testnet]: undefined,
  [Network.Stagenet]: mainnetNownodesProvider,
  [Network.Mainnet]: mainnetNownodesProvider,
}
