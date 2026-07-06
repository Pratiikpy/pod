import WebSocket from 'ws';

/**
 * SoDEX account WebSocket — real-time order/fill updates (F14). Subscribes to
 * `account-order-updates` for an address and calls back on each fill, so a
 * receipt shows "FILLED @ price" instead of "submitted". Long-lived, so it
 * belongs in a persistent worker (pod-workers), not a serverless function.
 *
 * On testnet, fills only arrive when the venue actually matches an order; the
 * connection + subscription path here is complete and works the moment a fill
 * occurs.
 */
const WS_URL: Record<'testnet' | 'mainnet', string> = {
  testnet: 'wss://testnet-gw.sodex.dev/ws/spot',
  mainnet: 'wss://mainnet-gw.sodex.dev/ws/spot',
};

export interface FillEvent {
  symbol?: string | undefined;
  orderID?: string | number | undefined;
  side?: string | undefined;
  price?: string | undefined;
  quantity?: string | undefined;
  status?: string | undefined;
  raw: unknown;
}

export interface AccountStreamHandle {
  close: () => void;
}

/**
 * Open an account order-update stream. Returns a handle to close it.
 * `onFill` fires for each order update the venue pushes.
 */
export function openAccountStream(params: {
  address: string;
  network?: 'testnet' | 'mainnet';
  onFill: (e: FillEvent) => void;
  onError?: (err: Error) => void;
}): AccountStreamHandle {
  const ws = new WebSocket(WS_URL[params.network ?? 'testnet']);
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        op: 'subscribe',
        params: { channel: 'account-order-updates', address: params.address },
      }),
    );
    // Keep-alive: SoDEX drops idle connections after 60s.
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
    }, 25_000);
  });

  ws.on('message', (data: WebSocket.RawData) => {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const m = msg as { channel?: string; data?: Record<string, unknown> };
    if (m.channel === 'account-order-updates' && m.data) {
      const d = m.data;
      params.onFill({
        symbol: d['symbol'] as string | undefined,
        orderID: d['orderID'] as string | number | undefined,
        side: d['side'] as string | undefined,
        price: d['price'] as string | undefined,
        quantity: d['quantity'] as string | undefined,
        status: d['status'] as string | undefined,
        raw: d,
      });
    }
  });

  ws.on('error', (err) => params.onError?.(err as Error));

  return {
    close: () => {
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}
