/**
 * Live testnet verification of the builder-code flow against the real gateway.
 * Testnet only (throwaway value). Never prints keys.
 *
 * Every check asserts what the gateway itself reports, including the AMOUNT of
 * builder fee charged on real fills, not just that a request was accepted.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  SoDEX,
  SoDEXAPIError,
  approveBuilderFeeTypedData,
  assertOrdersAccepted,
  canonicalDecimal,
  universalHeaders,
} from '../src/index.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const NETWORK = 'testnet' as const;
const GW = 'https://testnet-gw.sodex.dev/api/v1';
const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');
const master = privateKeyToAccount(pk);

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (v: unknown, n = 320) => JSON.stringify(v).slice(0, n);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const sign = (req: unknown) => master.signTypedData(req as never);

type Trade = { tradeID: number; clOrdID: string; side: string; price: string; quantity: string; fee?: string; builderFee?: string };

async function waitForFill(read: () => Promise<Trade[]>, clOrdID: string): Promise<Trade | undefined> {
  for (let i = 0; i < 6; i++) {
    await sleep(1500);
    const fill = (await read()).find((t) => t.clOrdID === clOrdID);
    if (fill) return fill;
  }
  return undefined;
}

/** Fee the gateway should charge: notional * rate / 100_000 (rate in tenths of a bp). */
const expectedFee = (price: string, qty: string, rateUnits: number) => (Number(price) * Number(qty) * rateUnits) / 100_000;
const near = (got: number, want: number) => Math.abs(got - want) <= Math.max(want * 0.05, 1e-9);

async function main() {
  const reader = SoDEX.publicOnly(NETWORK);
  const accountID = await reader.public.primaryAccountID(master.address);
  if (!accountID) throw new Error('testnet account is not activated');
  const builderID = accountID; // the same funded testnet account acts as builder
  console.log(`master ${master.address} account ${accountID}`);

  const masterOnly = SoDEX.fromPrivateKey(pk, NETWORK); // no X-API-Key: account-level actions + revocation
  const keysNow = (await reader.public.apiKeys(master.address, accountID)) as { spot?: Array<{ name: string; publicKey: string }> };
  const defaultKey = keysNow.spot?.find((k) => k.publicKey.toLowerCase() === master.address.toLowerCase());
  if (!defaultKey) throw new Error('no registered key matches the master address');
  const trader = SoDEX.fromPrivateKey(pk, NETWORK, defaultKey.name);

  // Remove anything a previous run left behind.
  for (const k of (keysNow.spot ?? []).filter((k) => /^bt/.test(k.name))) {
    for (const api of [masterOnly.spot, masterOnly.perps]) {
      try { await api.revokeAPIKey({ accountID, name: k.name }); } catch { /* absent on that engine */ }
    }
  }

  const bal = async () => {
    const s = (await reader.spot.balances(master.address)) as unknown as { data: { balances: Array<{ coin: string; total: string }> } };
    const p = (await reader.perps.balances(master.address)) as unknown as { data: { balances: Array<{ coin: string; total: string }> } };
    return {
      spot: Number(s.data.balances?.find((b) => b.coin === 'vUSDC')?.total ?? 0),
      perps: Number(p.data.balances?.find((b) => b.coin === 'vUSDC')?.total ?? 0),
    };
  };
  let b = await bal();
  if (b.perps < 105) {
    await trader.spot.transferAsset({ id: Date.now(), fromAccountID: accountID, toAccountID: 999, coinID: 0, amount: String(Math.ceil(105 - b.perps)), type: 'PERPS_WITHDRAW' });
    await sleep(4000);
    b = await bal();
  }
  record('builder holds >= 100 vUSDC in both engines', b.spot >= 100 && b.perps >= 100, short(b));

  const setApproval = async (maxFeeRate: number) => {
    await trader.public.approveBuilderFee(master.address, { network: NETWORK, accountID, builderID, maxFeeRate }, sign);
    await sleep(2500);
    return trader.public.approvalFor(master.address, builderID);
  };

  // Start from a known state: no approval.
  try { await setApproval(0); } catch { /* nothing to clear */ }

  // ── Approval lifecycle ──
  try {
    const r = await trader.public.approveBuilderFee(master.address, { network: NETWORK, accountID, builderID, maxFeeRate: 100 }, sign);
    record('approveBuilderFee accepted', r.code === 0, short(r));
  } catch (e) { record('approveBuilderFee accepted', false, msg(e)); }
  await sleep(2500);
  const ap = await trader.public.approvalFor(master.address, builderID);
  record('approval visible in BOTH engines at the requested rate', ap.approvedBothEngines && ap.spot === 100 && ap.perps === 100, short(ap));

  const stranger = privateKeyToAccount(generatePrivateKey());
  try {
    await trader.public.approveBuilderFee(master.address, { network: NETWORK, accountID, builderID, maxFeeRate: 60 }, (r) => stranger.signTypedData(r as never));
    record('approval signed by the wrong wallet is rejected', false, 'gateway ACCEPTED it');
  } catch (e) {
    record('approval signed by the wrong wallet is rejected', e instanceof SoDEXAPIError && !/balance/i.test(msg(e)), msg(e));
  }
  const afterWrong = await trader.public.approvalFor(master.address, builderID);
  record('a rejected approval left the stored rate untouched', afterWrong.spot === 100 && afterWrong.perps === 100, short(afterWrong));

  const fixed = approveBuilderFeeTypedData({ network: NETWORK, accountID, builderID, maxFeeRate: 100 });
  const sig = await master.signTypedData(fixed.request as never);
  const post = async () => (await fetch(`${GW}/user/${master.address}/builders`, {
    method: 'POST', headers: universalHeaders(NETWORK, sig, fixed.nonce), body: JSON.stringify(fixed.body),
  })).json() as Promise<{ code: number; error?: string }>;
  const first = await post();
  const second = await post();
  record('a nonce works once and its replay is rejected', first.code === 0 && second.code !== 0, `first=${short(first)} replay=${short(second)}`);

  // ── Spot: the fee is charged on the SELL side only, at min(requested, approved, cap) ──
  const symbols = (await reader.spot.symbols()) as unknown as { data: Array<{ id: number; name: string; displayName?: string; status: string }> };
  const spotSym = symbols.data.find((s) => s.status === 'TRADING' && (s.displayName ?? '') === 'BTC/USDC');
  const readSpot = async () => ((await reader.spot.userTrades(master.address, { limit: 20 })) as unknown as { data: Trade[] }).data;

  /** IOC market orders get CANCELED on a thin testnet book, so retry before calling it a failure. */
  async function spotBuy(builder?: { id: number; fee: number }): Promise<Trade | undefined> {
    if (!spotSym) return undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = `sb${attempt}-${Date.now()}`;
      try {
        assertOrdersAccepted(await trader.spot.batchNewOrder({
          accountID, ...(builder ? { builder } : {}),
          orders: [{ symbolID: spotSym.id, clOrdID: id, side: 'BUY', type: 'MARKET', timeInForce: 'IOC', funds: '6' }],
        }));
      } catch { continue; }
      const fill = await waitForFill(readSpot, id);
      if (fill) return fill;
    }
    return undefined;
  }

  async function spotRound(label: string, approved: number, requested: number) {
    if (!spotSym) { record(`${label}: a BTC/USDC spot pair is TRADING`, false, 'not trading on testnet right now'); return; }
    const buy = await spotBuy();
    if (!buy) { record(`${label}: setup BUY filled`, false, 'no fill after 4 attempts (book empty)'); return; }
    let sell: Trade | undefined;
    for (let attempt = 0; attempt < 4 && !sell; attempt++) {
      const sellID = `ss${attempt}-${Date.now()}`;
      try {
        assertOrdersAccepted(await trader.spot.batchNewOrder({
          accountID, builder: { id: builderID, fee: requested },
          orders: [{ symbolID: spotSym.id, clOrdID: sellID, side: 'SELL', type: 'MARKET', timeInForce: 'IOC', quantity: canonicalDecimal(buy.quantity) }],
        }));
      } catch (e) { record(`${label}: SELL with builder accepted`, false, msg(e)); return; }
      sell = await waitForFill(readSpot, sellID);
    }
    if (!sell) { record(`${label}: SELL filled`, false, 'no fill after 4 attempts'); return; }
    const charged = Number(sell.builderFee ?? 0);
    const rate = Math.min(approved, requested, 2000);
    const want = expectedFee(sell.price, sell.quantity, rate);
    record(`${label}: spot SELL builderFee is ${rate === 0 ? 'zero' : `~${(rate / 10).toFixed(1)} bp of notional`}`, rate === 0 ? charged === 0 : near(charged, want), `charged=${charged} expected~${want.toFixed(8)} fill=${short(sell, 240)}`);
  }

  // Documented rule: the BUY side carries no builder fee even when approved and requested.
  const buyWithBuilder = await spotBuy({ id: builderID, fee: 100 });
  record('spot BUY with an approved builder carries NO builder fee (documented)', !!buyWithBuilder && Number(buyWithBuilder.builderFee ?? 0) === 0, buyWithBuilder ? short(buyWithBuilder, 240) : 'no fill (book empty)');

  await setApproval(0);
  await spotRound('no approval', 0, 100);
  await setApproval(50);
  await spotRound('approved 50, requested 100', 50, 100);
  await setApproval(100);
  await spotRound('approved 100, requested 100', 100, 100);

  // ── Perps: fee on BOTH sides ──
  const psyms = (await reader.perps.symbols()) as unknown as { data: Array<Record<string, unknown> & { id: number; name: string; status: string }> };
  const readPerps = async () => ((await reader.perps.userTrades(master.address, { limit: 20 })) as unknown as { data: Trade[] }).data;
  let perpsDone = false;
  for (const name of ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'AVAX-USD', 'COPPER-USD']) {
    const sym = psyms.data.find((s) => s.name === name && s.status === 'TRADING');
    if (!sym) continue;
    const book = (await reader.perps.orderbook(sym.name, 5)) as unknown as { data: { asks?: Array<[string, string]>; bids?: Array<[string, string]> } };
    const px = Number(book.data.asks?.[0]?.[0] ?? book.data.bids?.[0]?.[0] ?? 0);
    if (!px) continue;
    const step = Number(sym['stepSize']);
    const minQty = Math.max(Number(sym['minQuantity']), (Number(sym['minNotional']) * 1.5) / px);
    const qty = canonicalDecimal((Math.ceil(minQty / step) * step).toFixed(Number(sym['quantityPrecision'])));
    const openID = `pbo-${Date.now()}`;
    try {
      assertOrdersAccepted(await trader.perps.newOrder({
        accountID, symbolID: sym.id, builder: { id: builderID, fee: 100 },
        orders: [{ clOrdID: openID, modifier: 1, side: 1, type: 2, timeInForce: 3, quantity: qty, reduceOnly: false, positionSide: 1 }],
      }));
    } catch (e) { console.log(`perps ${name} open refused: ${msg(e)}`); continue; }
    const open = await waitForFill(readPerps, openID);
    const closeID = `pbc-${Date.now()}`;
    let close: Trade | undefined;
    try {
      assertOrdersAccepted(await trader.perps.newOrder({
        accountID, symbolID: sym.id, builder: { id: builderID, fee: 100 },
        orders: [{ clOrdID: closeID, modifier: 1, side: 2, type: 2, timeInForce: 3, quantity: qty, reduceOnly: true, positionSide: 1 }],
      }));
      close = await waitForFill(readPerps, closeID);
    } catch (e) { record(`perps ${name} close with builder accepted`, false, msg(e)); }
    for (const [label, fill] of [['open', open], ['close', close]] as const) {
      const charged = Number(fill?.builderFee ?? Number.NaN);
      const want = fill ? expectedFee(fill.price, fill.quantity, 100) : Number.NaN;
      record(`perps ${name} ${label}: builderFee is ~10 bp of notional`, !!fill && near(charged, want), fill ? `charged=${charged} expected~${want.toFixed(8)}` : 'no fill');
    }
    perpsDone = true;
    break;
  }
  if (!perpsDone) record('a perps market accepted an order', false, 'every candidate market refused (open interest caps or no price)');

  // ── Key registration with a builder, then trade with that key ──
  const newKeyPk = generatePrivateKey();
  const newKey = privateKeyToAccount(newKeyPk);
  const keyLabel = `bt${Date.now().toString(36)}`.slice(0, 20);
  try {
    const added = await masterOnly.public.addApiKey(master.address, { network: NETWORK, accountID, name: keyLabel, publicKey: newKey.address, builder: { id: builderID, fee: 100 } }, sign);
    record('AddAPIKeyWithBuilder accepted', added.code === 0, short(added));
  } catch (e) { record('AddAPIKeyWithBuilder accepted', false, msg(e)); }
  await sleep(2500);
  const keys = (await reader.public.apiKeys(master.address, accountID)) as { spot?: Array<{ name: string }>; perps?: Array<{ name: string }> };
  const onSpot = !!keys.spot?.some((k) => k.name === keyLabel);
  const onPerps = !!keys.perps?.some((k) => k.name === keyLabel);
  record('new key is listed on BOTH engines', onSpot && onPerps, `spot=${onSpot} perps=${onPerps}`);
  if (spotSym) {
    const keyTrader = SoDEX.fromPrivateKey(newKeyPk, NETWORK, keyLabel);
    try {
      assertOrdersAccepted(await keyTrader.spot.batchNewOrder({
        accountID, builder: { id: builderID, fee: 100 },
        orders: [{ symbolID: spotSym.id, clOrdID: `bk-${Date.now()}`, side: 'BUY', type: 'MARKET', timeInForce: 'IOC', funds: '6' }],
      }));
      record('an order signed by the newly registered key is accepted', true, 'accepted');
    } catch (e) { record('an order signed by the newly registered key is accepted', false, msg(e)); }
  }
  for (const [engine, api] of [['spot', masterOnly.spot], ['perps', masterOnly.perps]] as const) {
    try { const r = await api.revokeAPIKey({ accountID, name: keyLabel }) as { code: number }; record(`revoke test key on ${engine}`, r.code === 0, short(r)); }
    catch (e) { record(`revoke test key on ${engine}`, false, msg(e)); }
  }

  // ── Clear ──
  try {
    const cleared = await setApproval(0);
    record('clearing with maxFeeRate 0 removes the approval from both engines', cleared.spot === 0 && cleared.perps === 0, short(cleared));
  } catch (e) { record('clearing with maxFeeRate 0 removes the approval from both engines', false, msg(e)); }

  console.log('\n==== SUMMARY ====');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`FAILED: ${f.name} -> ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('script error:', e); process.exit(2); });
