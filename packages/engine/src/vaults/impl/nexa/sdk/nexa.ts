import BigNumber from 'bignumber.js';

import { WebSocketRequest } from '@onekeyhq/shared/src/request/WebSocketRequest';

import { SimpleClient } from '../../../../client/BaseClient';

import type { CoinInfo } from '../../../../types/chain';
import type {
  AddressInfo,
  ClientInfo,
  FeePricePerUnit,
  TransactionStatus,
} from '../../../../types/provider';
import type { IListUXTO, INexaHistoryItem } from '../types';

export class Nexa extends SimpleClient {
  readonly rpc: WebSocketRequest;

  constructor(
    url: string,
    readonly defaultFinality: 'optimistic' | 'final' = 'optimistic',
  ) {
    super();
    this.rpc = new WebSocketRequest(url);
  }

  override getAddress(address: string): Promise<AddressInfo> {
    throw new Error('Method not implemented.');
  }

  override getTransactionStatus(txid: string): Promise<TransactionStatus> {
    throw new Error('Method not implemented.');
  }

  override async getInfo(): Promise<ClientInfo> {
    const info = await this.rpc.call<{
      height: number;
      hex: string;
    }>('blockchain.headers.tip');
    return {
      bestBlockNumber: info.height,
      isReady: true,
    };
  }

  override getFeePricePerUnit(): Promise<FeePricePerUnit> {
    throw new Error('Method not implemented.');
  }

  override async broadcastTransaction(
    rawTx: string,
    options?: any,
  ): Promise<string> {
    // Totally different from that the response string is not txid but txidm.
    return this.rpc.call<string>('blockchain.transaction.broadcast', [rawTx]);
  }

  override async getBalance(address: string): Promise<BigNumber> {
    const balanceInfo = await this.rpc.call<{
      confirmed: number;
      unconfirmed: number;
    }>('blockchain.address.get_balance', [address]);
    return new BigNumber(balanceInfo.confirmed);
  }

  async getNexaUTXOs(address: string): Promise<IListUXTO[]> {
    return this.rpc.call<IListUXTO[]>('blockchain.address.listunspent', [
      address,
    ]);
  }

  async getHistoryByAddress(address: string): Promise<INexaHistoryItem[]> {
    return this.rpc.call<INexaHistoryItem[]>('blockchain.address.get_history', [
      address,
    ]);
  }
}
