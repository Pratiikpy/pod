'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SoDEXAPIError } from '@pod/sodex-sdk';
import { POD, scoreColor } from '@/design/tokens';
import { APPROVAL_CEILING, BUILDER_ID, EXPLORER, FEE_DESCRIPTION, NETWORK, SODEX_CHAIN, TRADE_KEY_TTL_MS } from '@/lib/trade/config';
import {
  BuilderPausedError,
  KeyLimitError,
  enableTrading,
  forgetLocalKey,
  freeKeySlot,
  loadAccount,
  loadMarkets,
  loadWealthFunds,
  wealthMarkets,
  reapproveFee,
  type AccountSnapshot,
  type Market,
} from '@/lib/trade/engine';
import {
  checkBuyIsSellable,
  checkHoldingIsSellable,
  closePosition,
  fillsFor,
  loadPositions,
  marginNeeded,
  placePerps,
  placeSpot,
  quoteFor,
  sizeExact,
  sizeOrder,
  type OrderOutcome,
  type Position,
  type Submitted,
} from '@/lib/trade/orders';
import { checkBuilderHealth, type BuilderHealth } from '@/lib/trade/health';
import { loadTradeKey, type TradeKey } from '@/lib/trade/session';
import { connectWallet, discoverWallets, isUserRejection, type ConnectedWallet, type DiscoveredWallet } from '@/lib/trade/wallets';

type Tab = 'spot' | 'perps' | 'wealth';
type Side = 'BUY' | 'SELL';

interface Score {
  asset: string;
  name: string;
  direction: string;
  podScore: number;
  summary: string;
}

/**
 * What the order ticket knows about the order being typed. `key` names the inputs it was computed
 * for, so a preview that belongs to an older amount can never be shown or acted on.
 */
interface Preview {
  key: string;
  ok: boolean;
  text: string;
  detail?: string;
  /** A caution that does not block the order. */
  warning?: string;
  /** An amount that would fix the warning, offered as a one-click button. */
  suggestUsd?: number;
  /** For a spot sell: the amount that sells everything sellable. */
  maxSellUsd?: number;
  /** The exact quantity that sells everything sellable. */
  maxSellQty?: string;
}

const card: React.CSSProperties = {
  background: POD.ink850,
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 16,
  padding: 20,
};
const label: React.CSSProperties = { fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: POD.ink400 };
const mono: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** The three things a new trader does, with the current one highlighted. */
function stepStrip(current: 1 | 2 | 3) {
  const steps: ReadonlyArray<readonly [number, string, string]> = [
    [1, 'Fund SoDEX', 'Deposit 10 USDC or more from Base, Ethereum or Arbitrum. Skip if you already have an account.'],
    [2, 'Connect wallet', 'Use the same wallet you deposited from.'],
    [3, 'Enable trading', 'One signature, then trade.'],
  ];
  return (
    <ol data-testid="steps" style={{ listStyle: 'none', margin: '0 0 20px', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
      {steps.map(([n, title, body]) => {
        const done = n < current;
        const active = n === current;
        return (
          <li key={n} aria-current={active ? 'step' : undefined} style={{ ...card, padding: '12px 14px', borderColor: active ? 'rgba(207,255,61,0.45)' : 'rgba(255,255,255,0.05)', opacity: done ? 0.7 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: active ? POD.ink50 : POD.ink200 }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, background: active ? POD.lime : done ? POD.limeDeep : POD.ink700, color: active || done ? POD.ink900 : POD.ink300 }}>
                {done ? '✓' : n}
              </span>
              {title}
            </div>
            <div style={{ fontSize: 12.5, color: POD.ink400, lineHeight: 1.5, marginTop: 6 }}>{body}</div>
          </li>
        );
      })}
    </ol>
  );
}

/** One column on narrow screens. Every view that uses the two-column grid must include this. */
const responsive = <style>{`@media (max-width: 820px) { .pod-trade-grid { grid-template-columns: minmax(0,1fr) !important; } }`}</style>;

const usd = (n: number, d = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** One place that turns a thrown error into a sentence a trader can act on. */
function explain(err: unknown): string {
  if (isUserRejection(err)) return 'You declined the request in your wallet. Nothing was changed.';
  if (err instanceof BuilderPausedError) return err.message;
  const m = err instanceof Error ? err.message : String(err);
  if (/builder USDC balance is insufficient|builderID is invalid/i.test(m)) {
    return 'POD’s builder account is below the 100 USDC SoDEX requires, so fee approvals are paused. Try again shortly.';
  }
  if (/insufficient/i.test(m)) return `Not enough balance for this order. ${m}`;
  if (/API key not found|invalid signature|expired/i.test(m)) return 'Your trading key is no longer valid. Enable trading again to register a new one.';
  if (err instanceof SoDEXAPIError) return m.replace(/^SoDEX (API error on|rejected) [^:]*:\s*/, '');
  return m;
}

/** The honest account of an order: submitted and confirming, or what SoDEX's own data says happened. */
function OutcomeCard({ outcome, pending }: { outcome: OrderOutcome | null; pending: { submitted: Submitted; line: string } | null }) {
  if (!outcome && !pending) return null;
  if (!outcome && pending) {
    return (
      <div style={{ ...card, borderColor: 'rgba(255,255,255,0.18)' }} data-testid="outcome" data-state="confirming">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Order submitted. Confirming with SoDEX…</div>
        <div style={{ fontSize: 14, color: POD.ink300, lineHeight: 1.6 }} data-testid="outcome-progress">{pending.line}</div>
        <div style={{ fontSize: 12, color: POD.ink400, marginTop: 8 }}>
          Order {pending.submitted.orderID ?? pending.submitted.clOrdID}. It has been sent, so please do not send it again. This can take up to a minute.
        </div>
      </div>
    );
  }
  const o = outcome!;
  const r = o.result;
  const note = o.quote.note ? <><br /><span style={{ color: POD.ink400 }}>{o.quote.note}</span></> : null;

  if (r.state === 'filled') {
    const qty = r.fills.reduce((n, f) => n + Number(f.quantity), 0);
    const avg = qty > 0 ? r.fills.reduce((n, f) => n + Number(f.price) * Number(f.quantity), 0) / qty : Number(r.avgPrice ?? NaN);
    const fee = r.fills.reduce((n, f) => n + Number(f.fee ?? 0), 0);
    const builderFee = r.fills.reduce((n, f) => n + Number(f.builderFee ?? 0), 0);
    const coin = r.fills[0]?.feeCoin ?? '';
    const shownQty = qty > 0 ? String(qty) : r.executedQty ?? '';
    return (
      <div style={{ ...card, borderColor: 'rgba(207,255,61,0.35)' }} data-testid="outcome" data-state="filled" data-source={r.source}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{r.partial ? 'Order partly filled' : 'Order filled'}</div>
        <div style={{ fontSize: 14, color: POD.ink200, lineHeight: 1.8, ...mono }}>
          {shownQty ? <>{shownQty}{Number.isFinite(avg) ? ` at ${usd(avg, avg < 1 ? 5 : 2)}` : ''}<br /></> : null}
          {r.source === 'trades' ? (
            <>
              Total fee {fee} {coin}
              <br />
              POD builder fee {builderFee}
              {note}
            </>
          ) : (
            <span style={{ color: POD.ink400, fontFamily: 'inherit' }}>
              {r.source === 'order'
                ? 'SoDEX has not published the fee details yet. They will appear in your SoDEX history.'
                : 'Your balance changed. SoDEX has not published the price or fee details yet.'}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (r.state === 'not_filled') {
    return (
      <div style={{ ...card, borderColor: 'rgba(232,162,58,0.45)' }} data-testid="outcome" data-state="not_filled">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Order not filled</div>
        <div style={{ fontSize: 14, color: POD.ink300, lineHeight: 1.6 }}>{r.reason} (SoDEX status: {r.status}.)</div>
      </div>
    );
  }

  if (r.state === 'resting') {
    return (
      <div style={{ ...card, borderColor: 'rgba(232,162,58,0.45)' }} data-testid="outcome" data-state="resting">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Order is still open</div>
        <div style={{ fontSize: 14, color: POD.ink300 }}>SoDEX reports this order as open. Check your orders on SoDEX before sending another.</div>
      </div>
    );
  }

  return (
    <div style={{ ...card, borderColor: 'rgba(232,162,58,0.45)' }} data-testid="outcome" data-state="unknown">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Submitted, result not confirmed yet</div>
      <div style={{ fontSize: 14, color: POD.ink300, lineHeight: 1.6 }}>{r.detail}</div>
      <div style={{ fontSize: 12, color: POD.ink400, marginTop: 8 }}>Order {o.orderID ?? o.clOrdID}.</div>
    </div>
  );
}

export function TradeClient() {
  const params = useSearchParams();
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [key, setKey] = useState<TradeKey | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>(params.get('tab') === 'perps' ? 'perps' : 'spot');
  const [markets, setMarkets] = useState<Record<Tab, Market[]>>({ spot: [], perps: [], wealth: [] });
  const [wealthNote, setWealthNote] = useState<string | null>(null);
  const [marketLabel, setMarketLabel] = useState<string | null>(null);
  const [side, setSide] = useState<Side>(params.get('side') === 'sell' ? 'SELL' : 'BUY');
  const [amount, setAmount] = useState('10');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [filter, setFilter] = useState('');
  const [scores, setScores] = useState<Score[]>([]);
  const [scoresState, setScoresState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [positions, setPositions] = useState<Position[]>([]);
  const [outcome, setOutcome] = useState<OrderOutcome | null>(null);
  /** An order SoDEX has accepted but whose fate is still being confirmed. */
  const [pending, setPending] = useState<{ submitted: Submitted; line: string } | null>(null);
  const [leverage, setLeverage] = useState<number | null>(null);
  /** Set by "sell all": the order sells exactly this quantity instead of converting a dollar amount. */
  const [exactQty, setExactQty] = useState<string | null>(null);
  /** Set when the SoDEX account has no free API key slot, with the key POD can remove to make room. */
  const [keyLimit, setKeyLimit] = useState<KeyLimitError | null>(null);
  /** null while unknown. A failed read never blocks anyone. */
  const [health, setHealth] = useState<BuilderHealth | null>(null);
  /** True while we move the wallet to another chain ourselves, so its chainChanged event is not mistaken for a disconnect. */
  const switchingChain = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewSeq = useRef(0);

  // Wallet discovery.
  useEffect(() => {
    const stop = discoverWallets((found) => {
      setWallets(found);
      if (found.length > 0) setDiscovering(false);
    });
    const t = window.setTimeout(() => setDiscovering(false), 900);
    return () => {
      stop();
      window.clearTimeout(t);
    };
  }, []);

  // Is POD's builder account funded well enough for new sign-ups? Checked once, so nobody signs for nothing.
  useEffect(() => {
    checkBuilderHealth().then(setHealth);
  }, []);

  // POD scores and markets load once, independent of the wallet.
  useEffect(() => {
    fetch('/api/scores')
      .then((r) => r.json())
      .then((j: { scores?: Score[] }) => {
        setScores(j.scores ?? []);
        setScoresState('ready');
      })
      .catch(() => setScoresState('failed'));
    Promise.all([loadMarkets('spot'), loadMarkets('perps')])
      .then(async ([spot, perps]) => {
        let wealth: Market[] = [];
        try {
          wealth = wealthMarkets(await loadWealthFunds(), spot);
          if (wealth.length === 0) setWealthNote('No tokenized ETFs or stocks are tradable on this network right now.');
        } catch {
          setWealthNote('Wealth funds could not be loaded right now.');
        }
        setMarkets({ spot, perps, wealth });
      })
      .catch((e) => setError(explain(e)));
  }, []);

  const refresh = useCallback(
    async (c: ConnectedWallet, k: TradeKey | null) => {
      setLoadingAccount(true);
      try {
        const snap = await loadAccount(c.address, k);
        setAccount(snap);
        if (snap.accountID) setPositions(await loadPositions(c.address));
      } catch (e) {
        setError(explain(e));
      } finally {
        setLoadingAccount(false);
      }
    },
    [],
  );

  const connect = async (w: DiscoveredWallet) => {
    setError(null);
    setBusy('connect');
    try {
      const c = await connectWallet(w);
      const k = loadTradeKey(c.address);
      setConnected(c);
      setKey(k);
      await refresh(c, k);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  // Follow the wallet if the user switches account or network.
  useEffect(() => {
    const p = connected?.wallet.provider as { on?: (e: string, h: (...a: unknown[]) => void) => void; removeListener?: (e: string, h: (...a: unknown[]) => void) => void } | undefined;
    if (!p?.on || !connected) return;
    const onChange = () => {
      if (switchingChain.current) return;
      setConnected(null);
      setAccount(null);
      setKey(null);
      setOutcome(null);
    };
    p.on('accountsChanged', onChange);
    p.on('chainChanged', onChange);
    return () => {
      p.removeListener?.('accountsChanged', onChange);
      p.removeListener?.('chainChanged', onChange);
    };
  }, [connected]);

  const enable = async (wallet: ConnectedWallet | null = connected) => {
    if (!wallet || !account?.accountID) return;
    setError(null);
    setKeyLimit(null);
    setBusy('enable');
    try {
      if (key && account.keyListed && !account.approval.approvedBothEngines) {
        await reapproveFee(wallet, account.accountID);
        await refresh(wallet, key);
      } else {
        const res = await enableTrading(wallet, account.accountID);
        setKey(res.key);
        await refresh(wallet, res.key);
      }
    } catch (e) {
      if (e instanceof KeyLimitError) setKeyLimit(e);
      else setError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  /** Removes POD's oldest key to make room, then carries on enabling trading. */
  const freeSlot = async () => {
    if (!connected || !account?.accountID) return;
    setError(null);
    setBusy('free-slot');
    switchingChain.current = true;
    let wallet: ConnectedWallet | null = null;
    try {
      const res = await freeKeySlot(connected, account.accountID);
      wallet = res.connected;
      setConnected(wallet);
      setKeyLimit(null);
    } catch (e) {
      setError(explain(e));
    } finally {
      // Let the wallet's chainChanged event arrive before we start listening to it again.
      window.setTimeout(() => {
        switchingChain.current = false;
      }, 1500);
      setBusy(null);
    }
    if (wallet) await enable(wallet);
  };

  const ready = !!connected && !!account?.accountID && !!key && account.keyListed && account.approval.approvedBothEngines;

  // Selected market and the POD read for its base coin.
  const list = markets[tab];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? list.filter((m) => m.label.toLowerCase().includes(q)) : list;
  }, [list, filter]);

  // Apply ?asset= once markets arrive.
  const appliedAsset = useRef(false);
  useEffect(() => {
    if (appliedAsset.current || list.length === 0) return;
    const asset = params.get('asset')?.toUpperCase();
    if (asset) {
      const m = list.find((x) => x.baseCoin.toUpperCase() === asset || x.label.toUpperCase().startsWith(`${asset}/`) || x.label.toUpperCase().startsWith(`${asset}-`));
      if (m) setMarketLabel(m.label);
    }
    appliedAsset.current = true;
  }, [list, params]);

  const market = list.find((m) => m.label === marketLabel) ?? list.find((m) => /^BTC[/-]/.test(m.label)) ?? list[0] ?? null;
  const score = market ? scores.find((s) => s.asset.toUpperCase() === market.baseCoin.toUpperCase()) : undefined;

  // An exact sell quantity belongs to one market and one side.
  useEffect(() => {
    setExactQty(null);
  }, [market?.label, side, tab]);

  // The leverage selector starts at the market's own default and resets when the market changes.
  useEffect(() => {
    if (market?.engine === 'perps') setLeverage(market.initLeverage ?? 1);
    else setLeverage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.label, market?.engine]);

  const leverageOptions = useMemo(() => {
    if (market?.engine !== 'perps' || !market.maxLeverage) return [] as number[];
    const wanted = [1, 2, 3, 5, 10, 20, 40, market.initLeverage ?? 0, market.maxLeverage];
    return [...new Set(wanted.filter((l) => l >= 1 && l <= (market.maxLeverage ?? 1)))].sort((a, b) => a - b);
  }, [market]);

  // What the account holds of the selected spot market's base asset.
  const baseHolding = market && market.engine === 'spot' ? account?.spotHoldings.find((h) => h.coin.replace(/^v/, '') === market.baseCoin)?.total ?? 0 : null;

  // Live size, fee, sellability and margin preview. Every result is stamped with the inputs it was built from.
  const usdValue = Number(amount);
  const previewKey = `${market?.label}|${side}|${amount}|${leverage}|${reduceOnly}|${account?.approval.spot}|${account?.approval.perps}|${baseHolding}|${account?.perpsUsdc}|${exactQty}`;
  useEffect(() => {
    if (!market) return;
    const seq = ++previewSeq.current;
    const key = previewKey;
    if (!Number.isFinite(usdValue) || usdValue <= 0) {
      setPreview({ key, ok: false, text: 'Enter an amount above zero.' });
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const sized = exactQty && market.engine === 'spot' && side === 'SELL' ? await sizeExact(market, side, exactQty) : await sizeOrder(market, side, usdValue);
        if (seq !== previewSeq.current) return;
        if (!sized.ok) {
          setPreview({ key, ok: false, text: sized.reason });
          return;
        }
        const quote = quoteFor(market, side, Number(sized.notional), account?.approval[market.engine] ?? 0);
        const base: Preview = {
          key,
          ok: true,
          text: `${sized.quantity} ${market.baseCoin} at ${usd(sized.price, sized.price < 1 ? 5 : 2)}`,
          ...(quote.fee > 0 ? { detail: `POD builder fee about ${usd(quote.fee, 4)} (${quote.rateBp} bp)${quote.note ? `. ${quote.note}` : ''}` } : quote.note ? { detail: quote.note } : {}),
        };

        if (market.engine === 'spot' && side === 'SELL') {
          const held = baseHolding ?? 0;
          const check = checkHoldingIsSellable(market, held, sized.price);
          if (!check.ok) {
            setPreview({ key, ok: false, text: check.reason });
            return;
          }
          const maxUsd = Math.ceil(Number(check.notional) * 10000) / 10000;
          if (Number(sized.quantity) > Number(check.maxQuantity)) {
            setPreview({ key, ok: false, text: `You hold ${held} ${market.baseCoin} and can sell at most ${check.maxQuantity} (about ${usd(Number(check.notional))}).`, maxSellUsd: maxUsd, maxSellQty: check.maxQuantity });
            return;
          }
          setPreview({ ...base, maxSellUsd: maxUsd, maxSellQty: check.maxQuantity });
          return;
        }

        if (market.engine === 'spot' && side === 'BUY') {
          const sellable = checkBuyIsSellable(market, sized.quantity, sized.price);
          if (sellable && !sellable.sellable) {
            // Spot buy fees come out of the asset bought, and the amount spent can round down to a whole step.
            const suggest = sellable.suggestedNotional ? Math.ceil(Number(sellable.suggestedNotional) * 1.01 * 100) / 100 : undefined;
            setPreview({
              ...base,
              warning: `${sellable.reason}${suggest ? ` Buying about ${usd(suggest)} or more keeps it sellable.` : ''}`,
              ...(suggest ? { suggestUsd: suggest } : {}),
            });
            return;
          }
        }

        if (market.engine === 'perps' && !reduceOnly && leverage) {
          const need = marginNeeded(Number(sized.notional), leverage, Number(market.takerFee ?? 0.0004));
          const have = account?.perpsUsdc ?? 0;
          const lev = `${leverage}x leverage`;
          if (need > have) {
            const maxLev = market.maxLeverage ?? leverage;
            setPreview({
              ...base,
              ok: false,
              text: `This order needs about ${usd(need)} of margin at ${lev}, and your Perps balance is ${usd(have)}.${leverage < maxLev ? ` Raise leverage (up to ${maxLev}x) or add funds.` : ' Add funds to your Perps balance.'}`,
            });
            return;
          }
          setPreview({ ...base, detail: [`Margin about ${usd(need)} at ${lev}, of your ${usd(have)}`, base.detail].filter(Boolean).join('. ') });
          return;
        }
        setPreview(base);
      } catch (e) {
        if (seq === previewSeq.current) setPreview({ key, ok: false, text: explain(e) });
      }
    }, 350);
    return () => window.clearTimeout(t);
    // previewKey already contains every input the preview reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, market]);

  /**
   * An order confirmed from its own record or from the balance has no price or fee yet, because SoDEX's
   * trade list lags. Keep looking for a minute and upgrade the card when the fills appear.
   */
  const enrich = (res: OrderOutcome, m: Market, address: `0x${string}`, accountID: number) => {
    if (res.result.state !== 'filled' || res.result.source === 'trades') return;
    void (async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const rows = await fillsFor(m, address, accountID, res).catch(() => []);
        if (rows.length > 0) {
          setOutcome((prev) => (prev && prev.clOrdID === res.clOrdID && prev.result.state === 'filled' ? { ...prev, result: { ...prev.result, source: 'trades', fills: rows } } : prev));
          return;
        }
      }
    })();
  };

  const placing = busy === 'order';

  const place = async () => {
    if (!connected || !key || !account || !market) return;
    setError(null);
    setOutcome(null);
    setPending(null);
    setBusy('order');
    try {
      const approvedFee = account.approval[market.engine];
      const hooks = {
        onSubmitted: (submitted: Submitted) => setPending({ submitted, line: 'Submitted, confirming with SoDEX…' }),
        onProgress: (line: string) => setPending((p) => (p ? { ...p, line } : p)),
      };
      const res =
        market.engine === 'spot'
          ? await placeSpot({ key, address: connected.address, market, side, usd: usdValue, ...(exactQty && side === 'SELL' ? { quantity: exactQty } : {}), approvedFee, ...hooks })
          : await placePerps({ key, address: connected.address, market, side, usd: usdValue, reduceOnly, ...(leverage ? { leverage } : {}), approvedFee, ...hooks });
      setOutcome(res);
      enrich(res, market, connected.address, key.accountID);
      await refresh(connected, key);
    } catch (e) {
      setError(explain(e));
    } finally {
      setPending(null);
      setBusy(null);
    }
  };

  const close = async (p: Position) => {
    if (!connected || !key || !account) return;
    const m = markets.perps.find((x) => x.name === p.symbol);
    if (!m) {
      setError(`${p.symbol} is not tradable right now, so it cannot be closed from here.`);
      return;
    }
    setError(null);
    setOutcome(null);
    setPending(null);
    setBusy(`close-${p.symbol}`);
    try {
      const hooks = {
        onSubmitted: (submitted: Submitted) => setPending({ submitted, line: 'Submitted, confirming with SoDEX…' }),
        onProgress: (line: string) => setPending((q) => (q ? { ...q, line } : q)),
      };
      const closed = await closePosition({ key, address: connected.address, market: m, position: p, approvedFee: account.approval.perps, ...hooks });
      setOutcome(closed);
      enrich(closed, m, connected.address, key.accountID);
      await refresh(connected, key);
    } catch (e) {
      setError(explain(e));
    } finally {
      setPending(null);
      setBusy(null);
    }
  };

  // ── Rendering ────────────────────────────────────────────────────────────

  const header = (
    <>
      <div style={{ ...label, marginBottom: 8 }}>
        Signal to execution · {NETWORK === 'mainnet' ? 'SoDEX mainnet' : 'SoDEX testnet'}
      </div>
      <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 44, fontWeight: 400, margin: '0 0 8px' }}>
        Trade the POD signal
      </h1>
      <p style={{ color: POD.ink300, fontSize: 15, margin: '0 0 28px', maxWidth: 620 }}>
        Read the score, then trade on SoDEX from your own wallet. Orders are signed in this browser and sent straight to SoDEX. POD never holds your funds or keys.
      </p>
    </>
  );

  const errorBox = error && (
    <div role="alert" data-testid="error" style={{ ...card, borderColor: 'rgba(216,80,86,0.5)', color: '#F2B8BB', marginBottom: 16, padding: '12px 16px', fontSize: 14 }}>
      {error}
    </div>
  );

  if (!connected) {
    return (
      <>
        {responsive}
        {header}
        {stepStrip(2)}
        {errorBox}
        <div style={{ ...card, maxWidth: 560 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Connect a wallet</div>
          {wallets.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => connect(w)}
                  disabled={busy === 'connect'}
                  data-testid={`wallet-${w.name}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: POD.ink800, border: '1px solid rgba(255,255,255,0.08)', color: POD.ink50, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {w.icon ? <img src={w.icon} alt="" width={26} height={26} style={{ borderRadius: 6 }} /> : <span style={{ width: 26 }} />}
                  <span style={{ flex: 1 }}>{w.name}</span>
                  <span style={{ color: POD.ink400, fontSize: 13 }}>{busy === 'connect' ? 'Check your wallet…' : 'Connect'}</span>
                </button>
              ))}
            </div>
          ) : discovering ? (
            <p style={{ color: POD.ink400, fontSize: 14, margin: 0 }}>Looking for wallets…</p>
          ) : (
            <p style={{ color: POD.ink300, fontSize: 14, margin: 0, lineHeight: 1.6 }}>
              No browser wallet found. Install one such as MetaMask or Rabby, then reload this page. On a phone, open this page inside your wallet’s built-in browser.
            </p>
          )}
          <p style={{ color: POD.ink400, fontSize: 13, margin: '16px 0 0', lineHeight: 1.6 }}>
            Prefer Telegram? <a href="https://t.me/podttest_bot" style={{ color: POD.lime }}>Open the POD bot</a> for scores and alerts. Trading happens here, where you sign with your own wallet.
          </p>
        </div>
      </>
    );
  }

  const feeTable = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, margin: '14px 0' }}>
      {([['Spot', FEE_DESCRIPTION.spot], ['Perps', FEE_DESCRIPTION.perps]] as const).map(([k, v]) => (
        <div key={k} style={{ background: POD.ink800, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: POD.ink400 }}>{k}</div>
          <div style={{ fontSize: 14, color: POD.ink50 }}>{v}</div>
        </div>
      ))}
    </div>
  );

  const accountPanel = (
    <div style={card}>
      <div style={label}>Account</div>
      <div style={{ marginTop: 8, fontSize: 15, ...mono }}>{short(connected.address)}</div>
      {loadingAccount && !account ? (
        <p style={{ color: POD.ink400, fontSize: 14 }}>Reading your SoDEX account…</p>
      ) : account?.accountID ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: POD.ink400 }}>Spot USDC</div>
            <div style={{ fontSize: 18, ...mono }} data-testid="spot-usdc">{usd(account.spotUsdc)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: POD.ink400 }}>Perps USDC</div>
            <div style={{ fontSize: 18, ...mono }} data-testid="perps-usdc">{usd(account.perpsUsdc)}</div>
          </div>
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: POD.ink400 }}>
            Account {account.accountID} · POD fee approval {account.approval.approvedBothEngines ? 'on' : 'off'}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (!account?.accountID) {
    return (
      <>
        {responsive}
        {header}
        {stepStrip(1)}
        {errorBox}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }} className="pod-trade-grid">
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>This wallet has no SoDEX account yet</div>
            <p style={{ color: POD.ink300, fontSize: 14, lineHeight: 1.7, margin: '0 0 14px' }}>
              SoDEX creates your trading account with your first deposit. Deposit USDC (or SOSO) from Base, Ethereum or Arbitrum, then come back and check again. The minimum deposit is 5 USDC and smaller ones are not credited. The first deposit also pays 1 USDC to activate the account, and most spot markets need a $5 order, so 10 USDC or more is a comfortable start.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a href={EXPLORER.deposit} target="_blank" rel="noreferrer" style={{ background: POD.lime, color: POD.ink900, padding: '10px 16px', borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>
                Deposit on SoDEX
              </a>
              <button onClick={() => refresh(connected, key)} style={{ background: POD.ink800, color: POD.ink50, border: '1px solid rgba(255,255,255,0.1)', padding: '10px 16px', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>
                {loadingAccount ? 'Checking…' : 'Check again'}
              </button>
            </div>
          </div>
          {accountPanel}
        </div>
      </>
    );
  }

  if (!ready) {
    const needsReapprove = !!key && account.keyListed && !account.approval.approvedBothEngines;
    return (
      <>
        {responsive}
        {header}
        {stepStrip(3)}
        {errorBox}
        {health && !health.ok && (
          <div style={{ ...card, borderColor: 'rgba(232,162,58,0.5)', marginBottom: 16, padding: '12px 16px' }} data-testid="builder-paused">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>New sign-ups are paused for a moment</div>
            <div style={{ fontSize: 14, color: POD.ink300, lineHeight: 1.6 }}>
              SoDEX only accepts new fee approvals while POD’s builder account holds at least {health.floor} USDC in both Spot and Perps, and it is below that right now. Please try again shortly. If you are already enabled, trading is not affected.
            </div>
          </div>
        )}
        {keyLimit && (
          <div style={{ ...card, borderColor: 'rgba(232,162,58,0.5)', marginBottom: 16 }} data-testid="key-limit">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Your SoDEX account is out of API key slots</div>
            <p style={{ color: POD.ink300, fontSize: 14, lineHeight: 1.7, margin: '0 0 12px' }}>
              SoDEX allows {keyLimit.slots.used} API keys per account and keeps expired ones, and all {keyLimit.slots.used} are in use. Each browser you enable trading in uses one.
              {keyLimit.removable
                ? ` POD can remove the oldest key it made (${keyLimit.removable.name}) to make room. Your wallet will switch to the ${SODEX_CHAIN.name} network and ask for two signatures, one per engine, then one more to enable trading.`
                : ' None of them were made by POD, so POD cannot remove any. Remove one in your SoDEX account settings, then come back.'}
            </p>
            {keyLimit.removable && (
              <button
                onClick={freeSlot}
                disabled={!!busy}
                data-testid="free-slot"
                style={{ background: POD.amber, color: POD.ink900, border: 0, padding: '10px 16px', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: busy ? 'wait' : 'pointer' }}
              >
                {busy === 'free-slot' ? 'Confirm in your wallet…' : 'Remove the oldest POD key'}
              </button>
            )}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }} className="pod-trade-grid">
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{needsReapprove ? 'Approve the POD fee again' : 'Enable POD trading: one signature'}</div>
            <p style={{ color: POD.ink300, fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              One wallet signature registers a trading key that lives only in this browser and expires in {Math.round(TRADE_KEY_TTL_MS / 86_400_000)} days, and approves POD to charge a small fee on the orders it routes. You can clear the approval any time at{' '}
              <a href={EXPLORER.approvals} target="_blank" rel="noreferrer" style={{ color: POD.lime }}>sodex.com/builder-code-approvals</a>.
            </p>
            {feeTable}
            <p style={{ color: POD.ink400, fontSize: 13, margin: '0 0 16px' }}>
              The most you can ever be charged is {APPROVAL_CEILING / 10} bp ({APPROVAL_CEILING / 1000}%) of an order. Spot buys carry no fee. The fee is paid to POD’s SoDEX builder account {BUILDER_ID}.
            </p>
            <button
              onClick={() => enable()}
              disabled={busy === 'enable' || busy === 'free-slot' || (!!health && !health.ok)}
              data-testid="enable-trading"
              style={{ background: POD.lime, color: POD.ink900, border: 0, padding: '12px 20px', borderRadius: 12, fontWeight: 600, fontSize: 15, cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy === 'enable' ? 'Confirm in your wallet…' : needsReapprove ? 'Approve fee' : 'Enable trading'}
            </button>
          </div>
          {accountPanel}
        </div>
      </>
    );
  }

  // A preview built for an older amount is never shown as current, and never lets an order through.
  const previewFresh = preview?.key === previewKey;
  const canPlace = previewFresh && preview?.ok === true && !busy && !!market;
  const marginUsd = market?.engine === 'perps' && leverage && Number.isFinite(usdValue) ? marginNeeded(usdValue, leverage, Number(market.takerFee ?? 0.0004)) : null;

  return (
    <>
      {responsive}
      {header}
      {errorBox}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'start' }} className="pod-trade-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div style={card}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['spot', 'perps', 'wealth'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setMarketLabel(null);
                    setOutcome(null);
                    setSide('BUY');
                    appliedAsset.current = true;
                  }}
                  data-testid={`tab-${t}`}
                  style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: tab === t ? POD.lime : POD.ink800, color: tab === t ? POD.ink900 : POD.ink100, fontWeight: 600, fontSize: 14, cursor: 'pointer', textTransform: 'capitalize' }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
              <div>
                <div style={{ ...label, marginBottom: 6 }}>Market</div>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search markets"
                  aria-label="Search markets"
                  style={{ width: '100%', background: POD.ink800, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', color: POD.ink50, fontSize: 14, marginBottom: 8 }}
                />
                <div
                  role="listbox"
                  aria-label="Market"
                  data-testid="market-list"
                  style={{ height: 232, overflowY: 'auto', background: POD.ink800, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 4 }}
                >
                  {filtered.length === 0 && (
                    <div style={{ padding: 12, fontSize: 13, color: POD.ink400 }}>
                      {tab === 'wealth' && list.length === 0 ? wealthNote ?? 'Loading Wealth funds…' : `No market matches “${filter}”.`}
                    </div>
                  )}
                  {filtered.map((m) => {
                    const sc = scores.find((x) => x.asset.toUpperCase() === m.baseCoin.toUpperCase());
                    const active = m.label === market?.label;
                    return (
                      <button
                        key={m.label}
                        role="option"
                        aria-selected={active}
                        data-label={m.label}
                        ref={active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                        onClick={() => {
                          setMarketLabel(m.label);
                          setOutcome(null);
                        }}
                        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 8, border: 0, background: active ? 'rgba(207,255,61,0.14)' : 'transparent', color: active ? POD.ink50 : POD.ink200, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span>{m.label}</span>
                        {sc && <span style={{ fontSize: 12, fontWeight: 600, color: scoreColor(sc.podScore), ...mono }}>{sc.podScore}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ ...label, marginBottom: 6 }}>{tab === 'perps' ? 'Direction' : 'Side'}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {(['BUY', 'SELL'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      data-testid={`side-${s}`}
                      style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: side === s ? (s === 'BUY' ? POD.limeDeep : POD.red) : POD.ink800, color: POD.ink50, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                    >
                      {tab === 'perps' ? (s === 'BUY' ? 'Long' : 'Short') : s === 'BUY' ? 'Buy' : 'Sell'}
                    </button>
                  ))}
                </div>
                <div style={{ ...label, marginBottom: 6 }}>Amount (USDC)</div>
                <input
                  value={amount}
                  onChange={(e) => {
                    setExactQty(null);
                    setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                  }}
                  inputMode="decimal"
                  aria-label="Amount in USDC"
                  data-testid="amount"
                  style={{ width: '100%', background: POD.ink800, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', color: POD.ink50, fontSize: 18, ...mono }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[10, 25, 50, 100].map((v) => (
                    <button key={v} onClick={() => {
                      setExactQty(null);
                      setAmount(String(v));
                    }} style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: POD.ink800, color: POD.ink200, fontSize: 13, cursor: 'pointer' }}>
                      ${v}
                    </button>
                  ))}
                </div>
                {tab === 'perps' && (
                  <>
                    <div style={{ ...label, margin: '14px 0 6px' }}>Leverage</div>
                    <div role="radiogroup" aria-label="Leverage" data-testid="leverage" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {leverageOptions.map((l) => (
                        <button
                          key={l}
                          role="radio"
                          aria-checked={leverage === l}
                          data-leverage={l}
                          disabled={reduceOnly}
                          onClick={() => setLeverage(l)}
                          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: leverage === l ? POD.lime : POD.ink800, color: leverage === l ? POD.ink900 : POD.ink200, fontSize: 13, fontWeight: 600, cursor: reduceOnly ? 'not-allowed' : 'pointer', opacity: reduceOnly ? 0.5 : 1 }}
                        >
                          {l}x
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: POD.ink400, marginTop: 6 }} data-testid="margin-note">
                      {reduceOnly
                        ? 'A reduce-only order uses no new margin.'
                        : marginUsd !== null
                          ? `Needs about ${usd(marginUsd)} of margin at ${leverage}x. Higher leverage needs less margin and liquidates sooner. The market default is ${market?.initLeverage ?? 1}x.`
                          : ''}
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13, color: POD.ink300 }}>
                      <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
                      Reduce only (can only shrink a position)
                    </label>
                  </>
                )}
              </div>
            </div>

            {tab === 'wealth' && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: POD.ink400, lineHeight: 1.6 }} data-testid="wealth-note">
                Tokenized ETFs and stocks from SoDEX Wealth, traded on the spot order book. Vault funds (CXMT, UNITREE, Morpho Earn) need a ValueChain wallet flow and are not on this screen yet.
              </p>
            )}

            {score ? (
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: POD.ink800, display: 'flex', gap: 12, alignItems: 'center' }} data-testid="pod-read">
                <div style={{ fontSize: 26, fontWeight: 600, color: scoreColor(score.podScore), ...mono }}>{score.podScore}</div>
                <div style={{ fontSize: 13, color: POD.ink300, lineHeight: 1.5, minWidth: 0 }}>
                  <strong style={{ color: POD.ink50 }}>POD says {score.direction === 'BUY' ? 'buy' : score.direction === 'SELL' ? 'reduce' : 'hold'} {score.asset}.</strong>{' '}
                  {score.summary.length > 170 ? `${score.summary.slice(0, 167)}…` : score.summary}
                </div>
              </div>
            ) : scoresState === 'loading' ? (
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: POD.ink800, fontSize: 13, color: POD.ink400 }} data-testid="pod-read-loading">
                Reading the POD Score…
              </div>
            ) : scoresState === 'failed' ? (
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: POD.ink800, fontSize: 13, color: POD.ink400 }}>
                The POD Score could not be loaded right now. You can still trade.
              </div>
            ) : market ? (
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: POD.ink800, fontSize: 13, color: POD.ink400 }}>
                POD scores the ten spot-ETF coins. There is no POD read for {market.baseCoin}.
              </div>
            ) : null}

            {baseHolding !== null && market && (
              <div style={{ marginTop: 14, fontSize: 13, color: POD.ink300 }} data-testid="holding">
                You hold {baseHolding} {market.baseCoin} on spot.
                {side === 'SELL' && previewFresh && preview?.maxSellUsd ? (
                  <button
                    onClick={() => {
                      setAmount(String(preview.maxSellUsd));
                      setExactQty(preview.maxSellQty ?? null);
                    }}
                    data-testid="sell-max"
                    style={{ marginLeft: 10, padding: '3px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: POD.ink800, color: POD.ink100, fontSize: 12, cursor: 'pointer' }}
                  >
                    Sell all I can
                  </button>
                ) : null}
                {side === 'SELL' && baseHolding === 0 ? <span style={{ color: '#F2B8BB' }}> There is nothing to sell.</span> : null}
              </div>
            )}

            <div style={{ marginTop: 12, minHeight: 44 }} data-testid="preview" aria-live="polite" data-fresh={previewFresh ? 'yes' : 'no'}>
              {!previewFresh ? (
                <div style={{ fontSize: 14, color: POD.ink400 }}>Updating the quote…</div>
              ) : preview ? (
                <>
                  <div style={{ fontSize: 14, color: preview.ok ? POD.ink50 : '#F2B8BB', ...mono }}>{preview.text}</div>
                  {preview.detail && <div style={{ fontSize: 13, color: POD.ink400, marginTop: 4 }}>{preview.detail}</div>}
                  {preview.warning && (
                    <div data-testid="preview-warning" style={{ fontSize: 13, color: POD.amber, marginTop: 6, lineHeight: 1.5 }}>
                      {preview.warning}
                      {preview.suggestUsd ? (
                        <button
                          onClick={() => setAmount(String(preview.suggestUsd))}
                          data-testid="use-suggested"
                          style={{ marginLeft: 10, padding: '3px 10px', borderRadius: 8, border: '1px solid rgba(232,162,58,0.5)', background: 'transparent', color: POD.amber, fontSize: 12, cursor: 'pointer' }}
                        >
                          Use {usd(preview.suggestUsd)}
                        </button>
                      ) : null}
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <button
              onClick={place}
              disabled={!canPlace}
              data-testid="place-order"
              style={{ marginTop: 12, width: '100%', background: canPlace ? POD.lime : POD.ink700, color: canPlace ? POD.ink900 : POD.ink400, border: 0, padding: '14px 0', borderRadius: 12, fontWeight: 600, fontSize: 16, cursor: canPlace ? 'pointer' : 'not-allowed' }}
            >
              {placing ? (pending ? 'Confirming with SoDEX…' : 'Placing order…') : `${tab === 'perps' ? (side === 'BUY' ? 'Go long' : 'Go short') : side === 'BUY' ? 'Buy' : 'Sell'} ${market?.baseCoin ?? ''}`}
            </button>
            <p style={{ color: POD.ink400, fontSize: 12, margin: '10px 0 0' }}>
              Market order against the live book. Requested POD fee: {tab === 'perps' ? FEE_DESCRIPTION.perps : FEE_DESCRIPTION.spot}.
            </p>
          </div>

          <OutcomeCard outcome={outcome} pending={pending} />

          {tab === 'perps' && positions.length > 0 && (
            <div style={card} data-testid="positions">
              <div style={{ ...label, marginBottom: 10 }}>Open perps positions</div>
              {positions.map((p) => (
                <div key={p.symbol} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 14, ...mono }}>
                  <span style={{ flex: 1 }}>{p.symbol}</span>
                  <span style={{ color: Number(p.size) > 0 ? POD.limeSoft : POD.red }}>{Number(p.size) > 0 ? 'Long' : 'Short'} {p.size.replace(/^-/, '')}</span>
                  <span style={{ color: POD.ink400 }}>entry {p.avgEntryPrice}{p.leverage ? ` · ${p.leverage}x` : ''}</span>
                  <button onClick={() => close(p)} disabled={!!busy} style={{ background: POD.ink700, color: POD.ink50, border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    {busy === `close-${p.symbol}` ? 'Closing…' : 'Close'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {accountPanel}
          <div style={card}>
            <div style={label}>Your trading key</div>
            <p style={{ color: POD.ink300, fontSize: 13, lineHeight: 1.6, margin: '8px 0 12px' }}>
              Held in this browser, expires {new Date(key!.expiresAt).toLocaleDateString()}. Clear it on a shared computer.
            </p>
            <button
              onClick={() => {
                forgetLocalKey(connected.address);
                setKey(null);
                setOutcome(null);
              }}
              style={{ background: POD.ink800, color: POD.ink100, border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer' }}
            >
              Forget this key
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
