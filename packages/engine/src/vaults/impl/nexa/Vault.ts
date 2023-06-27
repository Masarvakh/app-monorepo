import BigNumber from 'bignumber.js';
import memoizee from 'memoizee';
import { Transaction } from 'nexcore-lib';

import VaultBtcFork from '@onekeyhq/engine/src/vaults/utils/btcForkChain/VaultBtcFork';
import { COINTYPE_NEXA } from '@onekeyhq/shared/src/engine/engineConsts';

import { InvalidAddress, OneKeyInternalError } from '../../../errors';
import {
  type IApproveInfo,
  type IClientEndpointStatus,
  type IDecodedTx,
  IDecodedTxActionType,
  IDecodedTxDirection,
  IDecodedTxStatus,
  type IEncodedTx,
  type IEncodedTxUpdateOptions,
  type IFeeInfo,
  type IFeeInfoUnit,
  type ITransferInfo,
  type IUnsignedTxPro,
} from '../../types';
import { VaultBase } from '../../VaultBase';
import { decodedTxToLegacy } from '../near/utils';

import {
  KeyringHardware,
  KeyringHd,
  KeyringImported,
  KeyringWatching,
} from './keyring';
import Provider from './provider';
import { Nexa } from './sdk';
import settings from './settings';
import { verifyNexaAddress } from './utils';

import type { BaseClient } from '../../../client/BaseClient';
import type {
  AccountCredentialType,
  DBAccount,
  DBSimpleAccount,
} from '../../../types/account';
import type { PartialTokenInfo } from '../../../types/provider';
import type { Token } from '../../../types/token';
import type {
  IDecodedTxAction,
  IDecodedTxLegacy,
  IHistoryTx,
  ISignedTxPro,
} from '../../types';
import type { EVMDecodedItem } from '../evm/decoder/types';
import type { IEncodedTxNexa } from './types';

export default class Vault extends VaultBase {
  keyringMap = {
    hd: KeyringHd,
    hw: KeyringHardware,
    imported: KeyringImported,
    watching: KeyringWatching,
    external: KeyringWatching,
  };

  override settings = settings;

  override createClientFromURL(url: string): BaseClient {
    return new Nexa(url);
  }

  createSDKClient = memoizee(
    async (rpcUrl: string, networkId: string) => {
      const sdkClient = this.createClientFromURL(rpcUrl) as Nexa;
      const chainInfo =
        await this.engine.providerManager.getChainInfoByNetworkId(networkId);
      // TODO move to base, setChainInfo like what ProviderController.getClient() do
      sdkClient.setChainInfo(chainInfo);
      return sdkClient;
    },
    {
      promise: true,
      primitive: true,
      normalizer(
        args: Parameters<(rpcUrl: string, networkId: string) => Promise<Nexa>>,
      ): string {
        return `${args[0]}:${args[1]}`;
      },
      max: 1,
      maxAge: 1000 * 60 * 15,
    },
  );

  async getSDKClient(): Promise<Nexa> {
    const { rpcURL } = await this.getNetwork();
    return this.createSDKClient(rpcURL, this.networkId);
  }

  override async getClientEndpointStatus(): Promise<IClientEndpointStatus> {
    const client = await this.getSDKClient();
    const start = performance.now();
    const latestBlock = (await client.getInfo()).bestBlockNumber;
    return { responseTime: Math.floor(performance.now() - start), latestBlock };
  }

  override async validateAddress(address: string): Promise<string> {
    const { isValid, normalizedAddress } = verifyNexaAddress(address);
    if (isValid) {
      return Promise.resolve(normalizedAddress || address);
    }
    return Promise.reject(new InvalidAddress());
  }

  override async getBalances(
    requests: Array<{ address: string; tokenAddress?: string }>,
  ): Promise<Array<BigNumber | undefined>> {
    // Abstract requests
    const client = await this.getSDKClient();
    return client.getBalances(
      requests.map(({ address, tokenAddress }) => ({
        address,
        coin: { ...(typeof tokenAddress === 'string' ? { tokenAddress } : {}) },
      })),
    );
  }

  override attachFeeInfoToEncodedTx(params: {
    encodedTx: IEncodedTx;
    feeInfoValue: IFeeInfoUnit;
  }): Promise<IEncodedTx> {
    return Promise.resolve(params.encodedTx);
  }

  override async decodeTx(
    encodedTx: IEncodedTxNexa,
    payload?: any,
  ): Promise<IDecodedTx> {
    const address = await this.getAccountAddress();
    const network = await this.getNetwork();

    const decodedTx: IDecodedTx = {
      txid: '',
      owner: address,
      signer: encodedTx.inputs[0].address || address,
      networkId: this.networkId,
      accountId: this.accountId,
      encodedTx,
      payload,
      extraInfo: null,
      nonce: 0,
      actions: [],
      status: IDecodedTxStatus.Pending,
    };

    return decodedTx;
  }

  override getNextNonce(
    networkId: string,
    dbAccount: DBAccount,
  ): Promise<number> {
    return Promise.resolve(0);
  }

  override decodedTxToLegacy(decodedTx: IDecodedTx): Promise<EVMDecodedItem> {
    return Promise.resolve({} as IDecodedTxLegacy);
  }

  override async buildEncodedTxFromTransfer(
    transferInfo: ITransferInfo,
  ): Promise<IEncodedTxNexa> {
    const client = await this.getSDKClient();
    const utxos = await client.getNexaUTXOs(transferInfo.from);
    return {
      inputs: utxos.map((utxo) => ({
        'txId': utxo.outpoint_hash,
        'outputIndex': utxo.tx_pos,
        'satoshis': utxo.value,
        'address': transferInfo.from,
      })),
      outputs: [
        {
          address: transferInfo.to,
          fee: transferInfo.amount,
          outType: 1,
        },
      ],
      totalFee: transferInfo.amount,
      transferInfo,
    };
  }

  override buildEncodedTxFromApprove(
    approveInfo: IApproveInfo,
  ): Promise<IEncodedTx> {
    throw new Error('Method not implemented.');
  }

  override updateEncodedTxTokenApprove(
    encodedTx: IEncodedTx,
    amount: string,
  ): Promise<IEncodedTx> {
    throw new Error('Method not implemented.');
  }

  override updateEncodedTx(
    encodedTx: IEncodedTxNexa,
    payload: any,
    options: IEncodedTxUpdateOptions,
  ): Promise<IEncodedTxNexa> {
    return Promise.resolve(encodedTx);
  }

  override buildUnsignedTxFromEncodedTx(
    encodedTx: IEncodedTxNexa,
  ): Promise<IUnsignedTxPro> {
    return Promise.resolve({
      inputs: [],
      outputs: [],
      payload: { encodedTx },
      encodedTx,
    });
  }

  override async fetchFeeInfo(
    encodedTx: IEncodedTx,
    signOnly?: boolean | undefined,
    specifiedFeeRate?: string | undefined,
    transferCount?: number | undefined,
  ): Promise<IFeeInfo> {
    const network = await this.getNetwork();
    const client = await this.getSDKClient();
    return {
      nativeSymbol: network.symbol,
      nativeDecimals: network.decimals,
      feeSymbol: network.feeSymbol,
      feeDecimals: network.feeDecimals,
      limit: '10',
      prices: [
        new BigNumber('10'.toString()).shiftedBy(-network.decimals).toFixed(),
      ],
      defaultPresetIndex: '1',
      tx: null,
    };
  }

  override getExportedCredential(
    password: string,
    credentialType: AccountCredentialType,
  ): Promise<string> {
    throw new Error('Method not implemented.');
  }

  override fetchTokenInfos(
    tokenAddresses: string[],
  ): Promise<(PartialTokenInfo | undefined)[]> {
    throw new Error('Method not implemented.');
  }

  override async broadcastTransaction(
    signedTx: ISignedTxPro,
    options?: any,
  ): Promise<ISignedTxPro> {
    const client = await this.getSDKClient();
    await client.broadcastTransaction(signedTx.rawTx);
    return signedTx;
  }

  override async fetchOnChainHistory(options: {
    tokenIdOnNetwork?: string | undefined;
    localHistory?: IHistoryTx[] | undefined;
    password?: string | undefined;
    passwordLoadedCallback?: ((isLoaded: boolean) => void) | undefined;
  }): Promise<IHistoryTx[]> {
    const { tokenIdOnNetwork, localHistory: localHistories = [] } = options;
    if (tokenIdOnNetwork) {
      return Promise.resolve([]);
    }

    const dbAccount = (await this.getDbAccount()) as DBSimpleAccount;
    const { decimals } = await this.engine.getNetwork(this.networkId);
    const client = await this.getSDKClient();
    const onChainHistories = await client.getHistoryByAddress(
      dbAccount.address,
    );
    return (
      await Promise.all(
        onChainHistories.map(async (history) => {
          const historyTxToMerge = localHistories.find(
            (item) => item.decodedTx.txid === history.tx_hash,
          );
          if (historyTxToMerge && !historyTxToMerge.decodedTx.isFinal) {
            console.log(historyTxToMerge, history);
            const tx = await client.getTransaction(history.tx_hash);

            let action: IDecodedTxAction = {
              type: IDecodedTxActionType.UNKNOWN,
            };
            const amountValue = tx.vin.reduce(
              (acc, cur) => acc + cur.value_satoshi,
              0,
            );
            const from = dbAccount.address;
            const to = dbAccount.address;
            const tokenAddress = dbAccount.address;
            if (amountValue && tokenAddress) {
              let direction = IDecodedTxDirection.IN;
              if (from === dbAccount.address) {
                direction =
                  to === dbAccount.address
                    ? IDecodedTxDirection.SELF
                    : IDecodedTxDirection.OUT;
              }
              const actionType = IDecodedTxActionType.TOKEN_TRANSFER;
              const token: Token | undefined =
                await this.engine.getNativeTokenInfo(this.networkId);
              const actionKey = 'tokenTransfer';

              action = {
                type: actionType,
                direction,
                [actionKey]: {
                  tokenInfo: token,
                  from,
                  to,
                  amount: new BigNumber(amountValue)
                    .shiftedBy(-token.decimals)
                    .toFixed(),
                  amountValue: amountValue.toString(),
                  extraInfo: null,
                },
              };
            }
            const decodedTx: IDecodedTx = {
              txid: history.tx_hash,
              owner: dbAccount.address,
              signer: dbAccount.address,
              nonce: 0,
              actions: [action],
              status: tx.confirmations
                ? IDecodedTxStatus.Confirmed
                : IDecodedTxStatus.Pending,
              networkId: this.networkId,
              accountId: this.accountId,
              encodedTx: {
                from: dbAccount.address,
                to: '',
                value: '',
                data: tx.hex,
              },
              extraInfo: null,
              totalFeeInNative: new BigNumber(
                tx.vout.reduce((acc, cur) => acc + cur.value_satoshi, 0),
              )
                .shiftedBy(-decimals)
                .toFixed(),
            };
            decodedTx.updatedAt = tx.time;
            decodedTx.createdAt =
              historyTxToMerge?.decodedTx.createdAt ?? decodedTx.updatedAt;
            decodedTx.isFinal = decodedTx.status === IDecodedTxStatus.Confirmed;
            return this.buildHistoryTx({
              decodedTx,
              historyTxToMerge,
            });
          }
        }),
      )
    ).filter(Boolean);
  }
}
