'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SoDEXAPIError } from '@pod/sodex-sdk';
import { POD, scoreColor } from '@/design/tokens';
import { APPROVAL_CEILING, BUILDER_ID, EXPLORER, FEE_DESCRIPTION, NETWORK } from '@/lib/trade/config';
import {
  closePosition,
  enableTrading,
  forgetLocalKey,
  loadAccount,
  loadMarkets,
  loadWealthFunds,
  wealthMarkets,
  loadPositions,
  placePerps,
  placeSpot,
  quoteFor,
  reapproveFee,
  sizeOrder,
  type AccountSnapshot,
  type Market,
  type OrderOutcome,
  type Position,
} from '@/lib/trade/engine';
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

const card: React.CSSProperties = {
  background: POD.ink850,
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 16,
  padding: 20,
};
const label: React.CSSProperties = { fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: POD.ink400 };
const mono: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** One column on narrow screens. Every view that uses the two-column grid must include this. */
const responsive = <style>{`@media (max-width: 820px) { .pod-trade-grid { grid-template-columns: minmax(0,1fr) !important; } }`}</style>;

const usd = (n: number, d = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** One place that turns a thrown error into a sentence a trader can act on. */
function explain(err: unknown): string {
  if (isUserRejection(err)) return 'You declined the request in your wallet. Nothing was changed.';
  const m = err instanceof Error ? err.message : String(err);
  if (/builder USDC balance is insufficient/i.test(m)) {
    return 'POD’s builder account is below the 100 USDC SoDEX requires, so fee approvals are paused. Try again shortly.';
  }
  if (/insufficient/i.test(m)) return `Not enough balance for this order. ${m}`;
  if (/API key not found|invalid signature|expired/i.test(m)) return 'Your trading key is no longer valid. Enable trading again to register a new one.';
  if (err instanceof SoDEXAPIError) return m.replace(/^SoDEX (API error on|rejected) [^:]*:\s*/, '');
  return m;
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
  const [preview, setPreview] = useState<{ text: string; ok: boolean; detail?: string } | null>(null);
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

  const enable = async () => {
    if (!connected || !account?.accountID) return;
    setError(null);
    setBusy('enable');
    try {
      if (key && account.keyListed && !account.approval.approvedBothEngines) {
        await reapproveFee(connected, account.accountID);
        await refresh(connected, key);
      } else {
        const res = await enableTrading(connected, account.accountID);
        setKey(res.key);
        await refresh(connected, res.key);
      }
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
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

  // Live size and fee preview.
  const usdValue = Number(amount);
  useEffect(() => {
    if (!market) return;
    const seq = ++previewSeq.current;
    if (!Number.isFinite(usdValue) || usdValue <= 0) {
      setPreview({ ok: false, text: 'Enter an amount above zero.' });
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const sized = await sizeOrder(market, side, usdValue);
        if (seq !== previewSeq.current) return;
        if (!sized.ok) {
          setPreview({ ok: false, text: sized.reason });
          return;
        }
        const q = quoteFor(market, side, Number(sized.notional), account?.approval[market.engine] ?? 0);
        setPreview({
          ok: true,
          text: `${sized.quantity} ${market.baseCoin} at ${usd(sized.price, sized.price < 1 ? 5 : 2)}`,
          detail: q.fee > 0 ? `POD builder fee about ${usd(q.fee, 4)} (${q.rateBp} bp)${q.note ? `. ${q.note}` : ''}` : q.note,
        });
      } catch (e) {
        if (seq === previewSeq.current) setPreview({ ok: false, text: explain(e) });
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [market, side, usdValue, account]);

  const place = async () => {
    if (!connected || !key || !account || !market) return;
    setError(null);
    setOutcome(null);
    setBusy('order');
    try {
      const approvedFee = account.approval[market.engine];
      const res =
        market.engine === 'spot'
          ? await placeSpot({ key, address: connected.address, market, side, usd: usdValue, approvedFee })
          : await placePerps({ key, address: connected.address, market, side, usd: usdValue, reduceOnly, approvedFee });
      setOutcome(res);
      await refresh(connected, key);
    } catch (e) {
      setError(explain(e));
    } finally {
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
    setBusy(`close-${p.symbol}`);
    try {
      setOutcome(await closePosition({ key, address: connected.address, market: m, position: p, approvedFee: account.approval.perps }));
      await refresh(connected, key);
    } catch (e) {
      setError(explain(e));
    } finally {
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
        {errorBox}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }} className="pod-trade-grid">
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>This wallet has no SoDEX account yet</div>
            <p style={{ color: POD.ink300, fontSize: 14, lineHeight: 1.7, margin: '0 0 14px' }}>
              SoDEX creates your trading account with your first deposit. Deposit USDC (or SOSO) from Base, Ethereum or Arbitrum, then come back and check again. The first deposit costs 1 USDC to activate the account.
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
        {errorBox}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }} className="pod-trade-grid">
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{needsReapprove ? 'Approve the POD fee again' : 'Enable POD trading: one signature'}</div>
            <p style={{ color: POD.ink300, fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              One wallet signature registers a trading key that lives only in this browser and expires in 14 days, and approves POD to charge a small fee on the orders it routes. You can clear the approval any time at{' '}
              <a href={EXPLORER.approvals} target="_blank" rel="noreferrer" style={{ color: POD.lime }}>sodex.com/builder-code-approvals</a>.
            </p>
            {feeTable}
            <p style={{ color: POD.ink400, fontSize: 13, margin: '0 0 16px' }}>
              The most you can ever be charged is {APPROVAL_CEILING / 10} bp ({APPROVAL_CEILING / 1000}%) of an order. Spot buys carry no fee. The fee is paid to POD’s SoDEX builder account {BUILDER_ID}.
            </p>
            <button
              onClick={enable}
              disabled={busy === 'enable'}
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

  const holding = market && side === 'SELL' && market.engine === 'spot' ? account.spotHoldings.find((h) => h.coin.replace(/^v/, '') === market.baseCoin)?.total ?? 0 : null;
  const canPlace = preview?.ok === true && !busy && !!market && (holding === null || holding > 0);

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
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  aria-label="Amount in USDC"
                  data-testid="amount"
                  style={{ width: '100%', background: POD.ink800, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', color: POD.ink50, fontSize: 18, ...mono }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[10, 25, 50, 100].map((v) => (
                    <button key={v} onClick={() => setAmount(String(v))} style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: POD.ink800, color: POD.ink200, fontSize: 13, cursor: 'pointer' }}>
                      ${v}
                    </button>
                  ))}
                </div>
                {tab === 'perps' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13, color: POD.ink300 }}>
                    <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
                    Reduce only (can only shrink a position)
                  </label>
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

            <div style={{ marginTop: 16, minHeight: 44 }} data-testid="preview" aria-live="polite">
              {preview && (
                <>
                  <div style={{ fontSize: 14, color: preview.ok ? POD.ink50 : '#F2B8BB', ...mono }}>{preview.text}</div>
                  {preview.detail && <div style={{ fontSize: 13, color: POD.ink400, marginTop: 4 }}>{preview.detail}</div>}
                </>
              )}
              {holding !== null && holding === 0 && (
                <div style={{ fontSize: 13, color: '#F2B8BB', marginTop: 4 }}>You hold no {market?.baseCoin} to sell on spot.</div>
              )}
            </div>

            <button
              onClick={place}
              disabled={!canPlace}
              data-testid="place-order"
              style={{ marginTop: 12, width: '100%', background: canPlace ? POD.lime : POD.ink700, color: canPlace ? POD.ink900 : POD.ink400, border: 0, padding: '14px 0', borderRadius: 12, fontWeight: 600, fontSize: 16, cursor: canPlace ? 'pointer' : 'not-allowed' }}
            >
              {busy === 'order' ? 'Placing order…' : `${tab === 'perps' ? (side === 'BUY' ? 'Go long' : 'Go short') : side === 'BUY' ? 'Buy' : 'Sell'} ${market?.baseCoin ?? ''}`}
            </button>
            <p style={{ color: POD.ink400, fontSize: 12, margin: '10px 0 0' }}>
              Market order, fills immediately against the live book. Requested POD fee: {tab === 'perps' ? FEE_DESCRIPTION.perps : FEE_DESCRIPTION.spot}.
            </p>
          </div>

          {outcome && (
            <div style={{ ...card, borderColor: outcome.filled ? 'rgba(207,255,61,0.35)' : 'rgba(232,162,58,0.45)' }} data-testid="outcome">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{outcome.filled ? 'Order filled' : 'Order accepted, no fill yet'}</div>
              {outcome.filled ? (
                <div style={{ fontSize: 14, color: POD.ink200, lineHeight: 1.8, ...mono }}>
                  {outcome.filled.quantity} at {usd(Number(outcome.filled.price), Number(outcome.filled.price) < 1 ? 5 : 2)}
                  <br />
                  Total fee {outcome.filled.fee ?? '0'} {outcome.filled.feeCoin ?? ''}
                  <br />
                  POD builder fee {outcome.filled.builderFee ?? '0'}
                  {outcome.quote.note ? <><br /><span style={{ color: POD.ink400 }}>{outcome.quote.note}</span></> : null}
                </div>
              ) : (
                <div style={{ fontSize: 14, color: POD.ink300 }}>
                  SoDEX accepted order {outcome.orderID ?? outcome.clOrdID}, but no fill has been reported. A market order that finds no liquidity is cancelled. Check your balances and try again.
                </div>
              )}
            </div>
          )}

          {tab === 'perps' && positions.length > 0 && (
            <div style={card} data-testid="positions">
              <div style={{ ...label, marginBottom: 10 }}>Open perps positions</div>
              {positions.map((p) => (
                <div key={p.symbol} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 14, ...mono }}>
                  <span style={{ flex: 1 }}>{p.symbol}</span>
                  <span style={{ color: Number(p.size) > 0 ? POD.limeSoft : POD.red }}>{Number(p.size) > 0 ? 'Long' : 'Short'} {p.size.replace(/^-/, '')}</span>
                  <span style={{ color: POD.ink400 }}>entry {p.avgEntryPrice}</span>
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
