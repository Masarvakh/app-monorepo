import fetch from 'cross-fetch';
import timeoutSignal from 'timeout-signal';

import simpleDb from '@onekeyhq/engine/src/dbs/simple/simpleDb';
import type { IJsonRpcResponsePro } from '@onekeyhq/engine/src/types';
import { generateUUID } from '@onekeyhq/kit/src/utils/helper';
import {
  JsonPRCResponseError,
  ResponseError,
} from '@onekeyhq/shared/src/errors/request-errors';

import type { IJsonRpcRequest } from '@onekeyfe/cross-inpage-provider-types';

type JsonRpcParams = undefined | { [p: string]: any } | Array<any>;

function normalizePayload(
  method: string,
  params: JsonRpcParams,
  id: string,
): IJsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

const socketsMap = new Map<string, WebSocket>();

const callbackMap = new Map<string, (result: any) => void>();

export class WebSocketRequest {
  readonly url: string;

  readonly timeout: number;

  readonly expiredTimeout: number;

  private expiredTimerId!: NodeJS.Timeout;

  constructor(url: string, timeout = 30000, expiredTimeout = 60 * 1000) {
    this.url = url;
    this.timeout = timeout;
    this.expiredTimeout = expiredTimeout;
    this.establishConnection();
  }

  private waitForSocketConnection(socket: WebSocket, callback: () => void) {
    setTimeout(() => {
      if (socket.readyState === 1 && callback) {
        callback();
      } else {
        this.waitForSocketConnection(socket, callback);
      }
    }, 5); // wait 5 milisecond for the connection...
  }

  private readySocketConnection(socket: WebSocket): Promise<WebSocket> {
    return new Promise((resolve) => {
      this.waitForSocketConnection(socket, () => {
        resolve(socket);
      });
    });
  }

  private establishConnection(): Promise<WebSocket> {
    const socket = socketsMap.get(this.url);
    if (socket) {
      if (socket.readyState === 1) {
        return Promise.resolve(socket);
      }
      return this.readySocketConnection(socket);
    }
    const wsuri =
      typeof document === 'undefined'
        ? this.url
        : `${document.location.protocol === 'http:' ? 'ws:' : 'wss:'}//${
            document.location.host
          }/nexa_ws`;
    const newSocket = new WebSocket(wsuri);
    socketsMap.set(this.url, newSocket);
    return new Promise((resolve) => {
      newSocket.onopen = () => {
        this.waitForSocketConnection(newSocket, () => {
          resolve(newSocket);
        });
      };

      newSocket.onmessage = (message) => {
        const { id, result } = JSON.parse(message.data) as {
          id: string;
          result: any;
        };
        callbackMap.get(id)?.(result);
        callbackMap.delete(id);
      };
      newSocket.onerror = (error: unknown) => {
        console.error(error);
      };
    });
  }

  private closeConnection() {
    const socket = socketsMap.get(this.url);
    if (socket) {
      socket.close();
      socketsMap.delete(this.url);
    }
  }

  private static parseRPCResponse<T>(
    response: IJsonRpcResponsePro<T>,
  ): Promise<T> {
    if (typeof response !== 'object') {
      throw new ResponseError(
        'Invalid JSON RPC response, typeof response should be an object',
        response,
      );
    } else if (response.error) {
      throw new JsonPRCResponseError('Error JSON PRC response', response);
    } else if (!('result' in response)) {
      throw new ResponseError(
        'Invalid JSON RPC response, result not found',
        response,
      );
    }

    return Promise.resolve(response.result as T);
  }

  async refreshConnectionStatus(): Promise<WebSocket> {
    const socket = await this.establishConnection();
    clearTimeout(this.expiredTimerId);
    this.expiredTimerId = setTimeout(() => {
      this.closeConnection();
    }, this.expiredTimeout);
    return socket;
  }

  async call<T>(
    method: string,
    params?: JsonRpcParams,
    timeout?: number,
  ): Promise<T> {
    const socket = await this.refreshConnectionStatus();
    return new Promise((resolve) => {
      const id = generateUUID();
      callbackMap.set(id, resolve);
      const requestParams = normalizePayload(method, params, id);
      if (socket) {
        socket.send(`${JSON.stringify(requestParams)}\n`);
      }
    });
  }
}
