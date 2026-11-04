/**
 * End-to-end test of /trade in a real browser against the REAL SoDEX testnet gateway.
 *
 * The page runs unmodified. The only fake is the wallet extension: an EIP-6963
 * provider whose eth_signTypedData_v4 is answered by a real local viem account,
 * so every signature the page requests is a genuine EIP-712 signature that the
 * gateway verifies. Truth is read back from the gateway, not from the page.
 *
 * Usage (dev server running with NEXT_PUBLIC_SODEX_NETWORK=testnet):
 *   node e2e/trade.e2e.mjs [baseUrl]
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SoDEX, allKeys, enginesHolding, floorToStep, pickKeyToRemove } from '@pod/sodex-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(resolve(globalRoot, 'noop.js'))('@playwright/test');

const BASE = process.argv[2] ?? 'http://localhost:3100';
const SHOTS = resolve(here, 'shots');
mkdirSync(SHOTS, { recursive: true });

// Funded testnet account (value-free). Read the key without ever printing it.
const envText = readFileSync(resolve(here, '../../../.env'), 'utf8');
const pk = envText.match(/^SODEX_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
if (!pk) throw new Error('SODEX_PRIVATE_KEY missing from .env');
const funded = privateKeyToAccount(pk);
const BUILDER_ID = 53229; // testnet builder, the same funded account

const reader = SoDEX.publicOnly('testnet');
const results = [];
const consoleProblems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${String(detail).slice(0, 360)}` : ''}`);
}

/** viem serialises uint values as decimal strings in the JSON the wallet receives. */
function reviveTypedData(json) {
  const td = JSON.parse(json);
  const { EIP712Domain, ...types } = td.types;
  const message = { ...td.message };
  for (const f of types[td.primaryType]) {
    if (/^u?int/.test(f.type) && typeof message[f.name] !== 'bigint') message[f.name] = BigInt(message[f.name]);
  }
  return { domain: td.domain, types, primaryType: td.primaryType, message };
}

/**
 * The testnet builder account is also the test user, and SoDEX refuses new fee approvals while it holds
 * less than 100 vUSDC in either engine. Every BUY in this suite spends spot USDC, so sell the BTC back
 * (and, if needed, move surplus between engines) whenever the floor is at risk.
 */
async function restoreBuilderFloor() {
  const read = async () => {
    const [s, p] = await Promise.all([reader.spot.balances(funded.address), reader.perps.balances(funded.address)]);
    const usdc = (r) => Number(r.data.balances.find((b) => b.coin === 'vUSDC')?.total ?? 0);
    return { spot: usdc(s), perps: usdc(p), btc: Number(s.data.balances.find((b) => b.coin === 'vBTC')?.total ?? 0) };
  };
  let b = await read();
  if (b.spot >= 104 && b.perps >= 104) return;
  const accountID = await reader.public.primaryAccountID(funded.address);
  const keys = await reader.public.apiKeys(funded.address, accountID);
  const keyName = keys.spot.find((k) => k.publicKey.toLowerCase() === funded.address.toLowerCase()).name;
  const trader = SoDEX.fromPrivateKey(pk, 'testnet', keyName);
  const sym = (await reader.spot.symbols()).data.find((x) => x.displayName === 'BTC/USDC');
  for (let attempt = 0; attempt < 4 && b.spot < 104; attempt++) {
    const bid = Number((await reader.spot.orderbook(sym.name, 5)).data.bids?.[0]?.[0] ?? 0);
    const qty = floorToStep(String(b.btc), sym.stepSize);
    if (!bid || Number(qty) * bid < 5.2) break;
    await trader.spot.batchNewOrder({ accountID, orders: [{ symbolID: sym.id, clOrdID: `rf-${Date.now()}-${attempt}`, side: 'SELL', type: 'MARKET', timeInForce: 'IOC', quantity: qty }] }).catch(() => {});
    await sleep(3500);
    b = await read();
  }
  if (b.spot < 101 && b.perps > 106) {
    const move = Math.ceil(Math.min(101 - b.spot + 3, b.perps - 104));
    if (move > 0) {
      await trader.perps.transferAsset({ id: Date.now(), fromAccountID: accountID, toAccountID: 999, coinID: 0, amount: String(move), type: 'SPOT_WITHDRAW' }).catch(() => {});
      await sleep(4000);
    }
  }
}

async function newPage(browser, { account, viewport = { width: 1280, height: 900 }, chainId = '0x1', wallet = true }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const state = { rejectNext: false, rejectSwitch: false, signed: [], chain: chainId, switches: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') consoleProblems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  // ERR_ABORTED is what a reload or a closing page does to an in-flight request, not a product failure.
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') consoleProblems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });

  if (wallet) {
    // A wallet that behaves like MetaMask where it matters: it refuses typed data whose domain chain
    // is not the active chain, it only switches to chains it knows, and it announces chain changes.
    const KNOWN = new Set(['0x1', '0x2105', '0x21d45', '0x45f9f']);
    await page.exposeFunction('__podRpc', async (method, params) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return { result: [account.address] };
      if (method === 'eth_chainId') return { result: state.chain };
      if (method === 'wallet_switchEthereumChain') {
        const want = params[0].chainId;
        state.switches.push(want);
        if (state.rejectSwitch) return { error: { code: 4001, message: 'User rejected the request.' } };
        if (!KNOWN.has(want)) return { error: { code: 4902, message: 'Unrecognized chain ID. Try adding the chain first.' } };
        state.chain = want;
        return { result: null, emit: ['chainChanged', want] };
      }
      if (method === 'eth_signTypedData_v4') {
        if (state.rejectNext) {
          state.rejectNext = false;
          return { error: { code: 4001, message: 'User rejected the request.' } };
        }
        const typed = reviveTypedData(params[1]);
        if (Number(typed.domain.chainId) !== Number(state.chain)) {
          return { error: { code: -32603, message: `Provided chainId "${typed.domain.chainId}" must match the active chainId "${Number(state.chain)}"` } };
        }
        state.signed.push({ primary: typed.primaryType, domain: typed.domain.name, domainChainId: typed.domain.chainId });
        return { result: await account.signTypedData(typed) };
      }
      return { error: { code: -32601, message: `unsupported ${method}` } };
    });
    await page.addInitScript(() => {
      const listeners = {};
      const provider = {
        request: async ({ method, params }) => {
          const r = await window.__podRpc(method, params);
          if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
          if (r.emit) setTimeout(() => (listeners[r.emit[0]] ?? []).forEach((fn) => fn(r.emit[1])), 0);
          return r.result;
        },
        on(event, fn) {
          (listeners[event] ??= []).push(fn);
        },
        removeListener(event, fn) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
        },
      };
      const detail = {
        info: { uuid: 'pod-test-wallet', name: 'POD Test Wallet', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><rect width="26" height="26" rx="6" fill="%23CFFF3D"/></svg>', rdns: 'dev.pod.test' },
        provider,
      };
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    });
  }
  return { page, context, state };
}

const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });

/** Clears the fee approval and revokes any key a previous run registered. */
async function resetAccount(accountID) {
  const masterOnly = SoDEX.fromPrivateKey(pk, 'testnet');
  const sign = (r) => funded.signTypedData(r);
  await masterOnly.public.approveBuilderFee(funded.address, { network: 'testnet', accountID, builderID: BUILDER_ID, maxFeeRate: 0 }, sign).catch(() => {});
  const remaining = await reader.public.apiKeys(funded.address, accountID);
  // Keys can sit on one engine only after a half-applied registration, so look at both lists.
  for (const k of allKeys(remaining).filter((x) => /^pod-/.test(x.name))) {
    for (const engine of enginesHolding(remaining, k.name)) await masterOnly[engine].revokeAPIKey({ accountID, name: k.name }).catch(() => {});
  }
  await sleep(1500);
}

async function main() {
  // The first score fan-out after a cold start can take close to a minute; production serves it from cache.
  await fetch(`${BASE}/api/scores`, { signal: AbortSignal.timeout(120000) }).catch(() => {});
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ── S1: no wallet installed ────────────────────────────────────────────
  {
    const { page, context } = await newPage(browser, { account: funded, wallet: false });
    await page.goto(`${BASE}/trade`);
    await page.getByText('No browser wallet found').waitFor({ timeout: 8000 });
    record('S1 no wallet: page explains how to get one', true);
    await shot(page, '01-no-wallet');
    await context.close();
  }

  // ── S2: wallet with no SoDEX account ───────────────────────────────────
  {
    const fresh = privateKeyToAccount(generatePrivateKey());
    const { page, context } = await newPage(browser, { account: fresh });
    await page.goto(`${BASE}/trade`);
    await page.getByTestId('wallet-POD Test Wallet').click();
    await page.getByText('This wallet has no SoDEX account yet').waitFor({ timeout: 15000 });
    record('S2 unactivated wallet: told to deposit first, no signature requested', (await page.getByTestId('enable-trading').count()) === 0);
    await shot(page, '02-not-activated');
    await context.close();
  }

  // ── S3..S10: the funded account ────────────────────────────────────────
  const accountID = await reader.public.primaryAccountID(funded.address);
  await restoreBuilderFloor();
  await resetAccount(accountID);
  const { page, context, state } = await newPage(browser, { account: funded, chainId: '0x1' });
  await page.goto(`${BASE}/trade`);
  await page.getByTestId('wallet-POD Test Wallet').click();
  await page.getByTestId('enable-trading').waitFor({ timeout: 20000 });
  record('S3 funded wallet: connected and shown the one-signature enable card', true);
  await shot(page, '03-enable');

  // S7 first: a declined signature leaves everything unchanged.
  state.rejectNext = true;
  await page.getByTestId('enable-trading').click();
  await page.getByTestId('error').waitFor({ timeout: 10000 });
  const rejectText = await page.getByTestId('error').innerText();
  const keysAfterReject = await reader.public.apiKeys(funded.address, accountID);
  const noNewKey = !(keysAfterReject.spot ?? []).some((k) => /^pod-/.test(k.name));
  record('S7 declined signature: friendly message, nothing registered', /declined/i.test(rejectText) && noNewKey, rejectText);
  await shot(page, '04-declined');

  // Enable for real.
  await page.getByTestId('enable-trading').click();
  await page.getByTestId('place-order').waitFor({ timeout: 40000 });
  record('S3b enable trading: one signature, wallet on Ethereum chain, page reaches trade view', state.signed.length >= 1 && state.signed.at(-1).primary === 'AddAPIKeyWithBuilder' && state.signed.at(-1).domainChainId === 1, JSON.stringify(state.signed));
  const keys = await reader.public.apiKeys(funded.address, accountID);
  const podKeySpot = (keys.spot ?? []).find((k) => /^pod-/.test(k.name));
  const podKeyPerps = (keys.perps ?? []).find((k) => /^pod-/.test(k.name));
  const approval = await reader.public.approvalFor(funded.address, BUILDER_ID);
  record('S3c gateway truth: key on BOTH engines and fee approval on BOTH engines', !!podKeySpot && !!podKeyPerps && approval.approvedBothEngines && approval.spot === 100 && approval.perps === 100, JSON.stringify({ spot: !!podKeySpot, perps: !!podKeyPerps, approval }));
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pod.tradekey.')));
  record('S3d trading key stored only in this browser', stored.length === 1 && /testnet/.test(stored[0]), JSON.stringify(stored));
  await shot(page, '05-ready');

  // Pick BTC spot.
  await page.locator('[role=option][data-label="BTC/USDC"]').click();
  // The score fan-out calls SoSoValue and can take well over a minute on a cold cache. That is an upstream delay,
  // so it is recorded as its own result and the rest of the suite still runs.
  const gotRead = await page.getByTestId('pod-read').waitFor({ timeout: 180000 }).then(() => true, () => false);
  const readText = gotRead ? await page.getByTestId('pod-read').innerText() : await page.getByTestId('pod-read-loading').innerText().catch(() => '(no score card at all)');
  record('S4-0 the POD Score and its reasoning are shown for the selected coin', gotRead && /POD says (buy|reduce|hold) BTC/.test(readText), readText.replace(/\s+/g, ' ').slice(0, 200));
  await shot(page, '05b-ready-with-score');

  // S8 validation states.
  await page.getByTestId('amount').fill('0');
  await page.getByText('Enter an amount above zero.').waitFor({ timeout: 5000 });
  record('S8a amount 0: explained and order disabled', await page.getByTestId('place-order').isDisabled());
  await page.getByTestId('amount').fill('1');
  await page.getByTestId('preview').getByText(/minimum/i).waitFor({ timeout: 8000 });
  record('S8b below minimum notional: explained and order disabled', await page.getByTestId('place-order').isDisabled(), await page.getByTestId('preview').innerText());

  // S4 spot BUY.
  await page.getByTestId('amount').fill('6');
  await page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 8000 });
  const previewBuy = await page.getByTestId('preview').innerText();
  record('S4a BUY preview shows quantity, price and that spot buys carry no fee', /BTC at/.test(previewBuy) && /no builder fee/i.test(previewBuy), previewBuy);
  await shot(page, '06-buy-preview');
  const tradesBefore = (await reader.spot.userTrades(funded.address, { limit: 20 })).data.map((t) => t.tradeID);
  await page.getByTestId('place-order').click();
  await page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
  const buyOutcome = await page.getByTestId('outcome').innerText();
  const buyTrade = (await reader.spot.userTrades(funded.address, { limit: 20 })).data.find((t) => !tradesBefore.includes(t.tradeID) && t.side === 'BUY');
  record('S4b BUY filled: page and gateway agree, builder fee zero', /Order filled/.test(buyOutcome) && !!buyTrade && Number(buyTrade.builderFee ?? 0) === 0, `${buyOutcome.replace(/\n/g, ' | ')} || gateway: ${JSON.stringify(buyTrade)}`);
  await shot(page, '07-buy-filled');

  // S5 spot SELL.
  await page.getByTestId('side-SELL').click();
  await page.getByTestId('amount').fill('5');
  await page.getByTestId('preview').getByText(/smallest order right now/i).waitFor({ timeout: 10000 });
  record('S5-pre selling exactly the minimum: told the smallest valid order instead of failing', await page.getByTestId('place-order').isDisabled(), await page.getByTestId('preview').innerText());
  await page.getByTestId('amount').fill('6');
  await page.getByTestId('preview').getByText(/builder fee about/i).waitFor({ timeout: 10000 });
  const previewSell = await page.getByTestId('preview').innerText();
  record('S5a SELL preview shows an estimated POD fee at 10 bp', /10 bp/.test(previewSell), previewSell);
  const sellBefore = (await reader.spot.userTrades(funded.address, { limit: 20 })).data.map((t) => t.tradeID);
  await page.getByTestId('place-order').click();
  await page.getByTestId('outcome').getByText(/Order filled/).waitFor({ timeout: 30000 });
  // If SoDEX's trade list lags, the card first says the fee details are not published yet and upgrades itself later.
  await page.getByTestId('outcome').getByText(/POD builder fee/).waitFor({ timeout: 80000 });
  const sellOutcome = await page.getByTestId('outcome').innerText();
  const sellTrade = (await reader.spot.userTrades(funded.address, { limit: 20 })).data.find((t) => !sellBefore.includes(t.tradeID) && t.side === 'SELL');
  const shownFee = Number(sellOutcome.match(/POD builder fee ([0-9.]+)/)?.[1] ?? NaN);
  const wantFee = sellTrade ? (Number(sellTrade.price) * Number(sellTrade.quantity) * 100) / 100000 : NaN;
  record('S5b SELL filled: builder fee on the page equals the gateway and equals 10 bp of notional', !!sellTrade && Number(sellTrade.builderFee) > 0 && Math.abs(Number(sellTrade.builderFee) - shownFee) < 1e-9 && Math.abs(Number(sellTrade.builderFee) - wantFee) <= wantFee * 0.05, `page=${shownFee} gateway=${sellTrade?.builderFee} expected~${wantFee}`);
  await shot(page, '08-sell-filled');

  // S8c selling something not held.
  await page.locator('[role=option][data-label="ETH/USDC"]').click();
  await page.getByText(/There is nothing to sell/).waitFor({ timeout: 8000 }).then(
    async () => record('S8c selling an asset you do not hold: explained and disabled', await page.getByTestId('place-order').isDisabled()),
    () => record('S8c selling an asset you do not hold: explained and disabled', false, 'message not shown'),
  );

  // S6 perps long, then close from the positions list.
  await page.getByTestId('tab-perps').click();
  await page.locator('[role=option][data-label="ETH-USD"]').click();
  await page.getByTestId('side-BUY').click();
  await page.getByTestId('amount').fill('15');
  await page.getByTestId('preview').getByText(/ETH at/).waitFor({ timeout: 8000 });
  const perpsBefore = (await reader.perps.userTrades(funded.address, { limit: 20 })).data.map((t) => t.tradeID);
  await page.getByTestId('place-order').click();
  await page.getByTestId('outcome').getByText(/Order filled/).waitFor({ timeout: 30000 });
  const longTrade = (await reader.perps.userTrades(funded.address, { limit: 20 })).data.find((t) => !perpsBefore.includes(t.tradeID));
  const longOutcome = await page.getByTestId('outcome').innerText();
  const longWant = longTrade ? (Number(longTrade.price) * Number(longTrade.quantity) * 100) / 100000 : NaN;
  record('S6a perps long filled with a 10 bp builder fee', !!longTrade && Math.abs(Number(longTrade.builderFee) - longWant) <= longWant * 0.05, `gateway=${longTrade?.builderFee} expected~${longWant} page=${longOutcome.replace(/\n/g, ' | ')}`);
  await page.getByTestId('positions').waitFor({ timeout: 10000 });
  await shot(page, '09-perps-position');
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByTestId('outcome').getByText(/Order filled/).waitFor({ timeout: 30000 });
  await sleep(2000);
  const positionsAfter = (await reader.perps.positions(funded.address)).data.positions.filter((p) => Number(p.size) !== 0);
  record('S6b closing from the page leaves no open position on the gateway', positionsAfter.length === 0, JSON.stringify(positionsAfter));
  await shot(page, '10-perps-closed');

  // S11 Wealth tab. Testnet has no tokenized-ETF markets, so the real response is an empty list,
  // and a mocked funds response (pointing at a real testnet symbol) proves the listing path.
  {
    await page.getByTestId('tab-wealth').click();
    await page.getByText(/No tokenized ETFs or stocks are tradable on this network right now/).waitFor({ timeout: 10000 });
    record('S11a Wealth tab on a network with no tokenized ETFs: honest empty state', (await page.getByTestId('wealth-note').count()) === 1);
    await shot(page, '14-wealth-empty');
    const testnetSpot = (await reader.spot.symbols()).data.filter((x) => x.status === 'TRADING');
    // A market with a live order book, so the sizing path has a price to work from.
    let pick = testnetSpot[0];
    for (const c of testnetSpot) {
      const book = await reader.spot.orderbook(c.name, 5).catch(() => null);
      if (book?.data?.asks?.length) {
        pick = c;
        break;
      }
    }
    const ctx2 = await newPage(browser, { account: funded });
    await ctx2.page.route('**/wealth/funds', (route) => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 0, data: [
        { fundId: 'vMOCK', name: 'Mock fund', fundType: 'clob', fundStatus: 'live', spot: { symbol: pick.name, symbolId: pick.id, displayName: pick.displayName } },
        { fundId: 'VAULT1', name: 'Vault', fundType: 'escrow_vault', fundStatus: 'live' },
      ] }),
    }));
    await ctx2.page.goto(`${BASE}/trade`);
    await ctx2.page.getByTestId('wallet-POD Test Wallet').click();
    await ctx2.page.getByTestId('enable-trading').waitFor({ timeout: 20000 });
    await ctx2.page.getByTestId('enable-trading').click();
    await ctx2.page.getByTestId('place-order').waitFor({ timeout: 40000 });
    await ctx2.page.getByTestId('tab-wealth').click();
    const options = await ctx2.page.locator('[role=option]').allInnerTexts();
    record('S11b Wealth tab lists exactly the live order-book funds and skips vault funds', options.length === 1 && options[0].includes(pick.displayName), JSON.stringify(options));
    await ctx2.page.getByTestId('preview').getByText(/at \$/).waitFor({ timeout: 10000 }).then(
      () => record('S11c a Wealth market sizes an order through the same spot path', true),
      async () => record('S11c a Wealth market sizes an order through the same spot path', false, await ctx2.page.getByTestId('preview').innerText()),
    );
    await shot(ctx2.page, '15-wealth-listed');
    await ctx2.context.close();
  }

  // S12 deep links: the asset page and the Telegram bot hand off to /trade with the coin and POD's side.
  {
    const probe = await newPage(browser, { account: funded });
    await probe.page.goto(`${BASE}/asset/BTC`);
    const cta = probe.page.getByTestId('trade-cta');
    await cta.waitFor({ timeout: 60000 });
    const href = await cta.getAttribute('href');
    record('S12a asset page: primary button goes to the trade page for that coin', /^\/trade\?asset=BTC(&side=(buy|sell))?$/.test(href ?? ''), href ?? '');
    await shot(probe.page, '16-asset-cta');
    await probe.context.close();

    const deep = await newPage(browser, { account: funded });
    await deep.page.goto(`${BASE}/trade?asset=ETH&side=sell`);
    await deep.page.getByTestId('wallet-POD Test Wallet').click();
    await deep.page.getByTestId('enable-trading').waitFor({ timeout: 20000 });
    await deep.page.getByTestId('enable-trading').click();
    await deep.page.getByTestId('place-order').waitFor({ timeout: 40000 });
    const selected = await deep.page.locator('[role=option][aria-selected=true]').first().getAttribute('data-label');
    const sellActive = await deep.page.getByTestId('side-SELL').evaluate((el) => getComputedStyle(el).backgroundColor);
    record('S12b /trade?asset=ETH&side=sell opens with ETH selected and Sell active', selected === 'ETH/USDC' && sellActive === 'rgb(216, 80, 86)', `selected=${selected} sellBg=${sellActive}`);
    await shot(deep.page, '17-deeplink');
    await deep.context.close();
  }

  // S14 onboarding strip.
  {
    const o = await newPage(browser, { account: privateKeyToAccount(generatePrivateKey()) });
    await o.page.goto(`${BASE}/trade`);
    const strip = await o.page.getByTestId('steps').innerText();
    record('S14a connect view shows the three onboarding steps', /Fund SoDEX/.test(strip) && /Connect wallet/.test(strip) && /Enable trading/.test(strip), strip.replace(/\s+/g, ' '));
    await o.page.getByTestId('wallet-POD Test Wallet').click();
    await o.page.getByText('This wallet has no SoDEX account yet').waitFor({ timeout: 15000 });
    const current = await o.page.locator('[data-testid=steps] li[aria-current=step]').innerText();
    record('S14b a wallet with no account sees step 1 (fund SoDEX) highlighted', /Fund SoDEX/.test(current), current.replace(/\s+/g, ' '));
    await shot(o.page, '18-steps-unfunded');
    await o.context.close();
  }

  // ── S15..S22: the failures found by real-money mainnet testing, reproduced on testnet ──
  {
    /** Opens a fresh connected session on the trade view, optionally with the gateway made to misbehave. */
    const session = async (setup) => {
      await restoreBuilderFloor();
      const s = await newPage(browser, { account: funded });
      const before = new Set(((await reader.public.apiKeys(funded.address, accountID)).spot ?? []).map((k) => k.name));
      if (setup) await setup(s.page);
      await s.page.goto(`${BASE}/trade`);
      await s.page.getByTestId('wallet-POD Test Wallet').click();
      await s.page.getByTestId('enable-trading').waitFor({ timeout: 25000 });
      await s.page.getByTestId('enable-trading').click();
      await s.page.getByTestId('place-order').waitFor({ timeout: 40000 }).catch(async (e) => {
        console.log('SESSION SETUP FAILED. Page says:', (await s.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 700));
        await shot(s.page, 'debug-session-fail');
        throw e;
      });
      await s.page.locator('[role=option][data-label="BTC/USDC"]').click();
      const fresh = ((await reader.public.apiKeys(funded.address, accountID)).spot ?? []).map((k) => k.name).filter((n) => !before.has(n));
      // Closes the browser and removes the key this session registered, so the 10-key cap is not hit mid-suite.
      s.finish = async () => {
        await s.context.close();
        const m = SoDEX.fromPrivateKey(pk, 'testnet');
        for (const n of fresh) for (const api of [m.spot, m.perps]) await api.revokeAPIKey({ accountID, name: n }).catch(() => {});
      };
      return s;
    };
    const empty = (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 0, data: [] }) });
    const emptyOrders = (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 0, data: { orders: [] } }) });
    const NO_OLD_COPY = /no fill yet|try again\./i;

    // S15: the mainnet symptom. Trades, open orders and order history are ALL empty although the order fills.
    // The page must say "confirming", then "filled" from the balance change, and never "no fill".
    {
      const s = await session(async (page) => {
        await page.route('**/spot/accounts/*/trades*', empty);
        await page.route('**/spot/accounts/*/orders/history*', empty);
        await page.route('**/spot/accounts/*/orders?*', emptyOrders);
      });
      await s.page.getByTestId('amount').fill('8');
      await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
      await s.page.getByTestId('place-order').click();
      await s.page.locator('[data-testid=outcome][data-state=confirming]').waitFor({ timeout: 20000 });
      const confirmingText = await s.page.getByTestId('outcome').innerText();
      const lockedWhileConfirming = await s.page.getByTestId('place-order').isDisabled();
      record('S15a while confirming the page says it was submitted, not to send it again, and the button is locked', /submitted/i.test(confirmingText) && /do not send it again/i.test(confirmingText) && lockedWhileConfirming, `locked=${lockedWhileConfirming} :: ${confirmingText.replace(/\s+/g, ' ')}`);
      await s.page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
      const done = await s.page.getByTestId('outcome');
      const source = await done.getAttribute('data-source');
      const doneText = await done.innerText();
      record('S15b with every list empty, the fill is still reported, from the balance change', source === 'balance' && /Order filled/.test(doneText) && !NO_OLD_COPY.test(doneText), `source=${source} :: ${doneText.replace(/\s+/g, ' ')}`);
      await shot(s.page, '19-confirm-balance-only');
      const freed = await s.page.waitForFunction(() => { const b = document.querySelector('[data-testid=place-order]'); return !!b && !b.disabled; }, null, { timeout: 25000 }).then(() => true, () => false);
      record('S15c once the outcome is known the Place button is free again', freed);
      await s.finish();
    }

    // S16: only the trades list is empty. History may or may not have caught up; either way it is a fill.
    {
      const s = await session(async (page) => {
        await page.route('**/spot/accounts/*/trades*', empty);
      });
      await s.page.getByTestId('amount').fill('8');
      await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
      await s.page.getByTestId('place-order').click();
      await s.page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
      const source = await s.page.getByTestId('outcome').getAttribute('data-source');
      record('S16 trades list empty: still reported as filled, from the order record or the balance', ['order', 'balance'].includes(source ?? ''), `source=${source}`);
      await s.finish();
    }

    // S17: nothing can prove or disprove the fill (balances frozen, lists empty). The page must say it does not
    // know, tell the user not to resend, and must NOT claim the order failed.
    {
      const frozen = await reader.spot.balances(funded.address);
      const s = await session(async (page) => {
        await page.route('**/spot/accounts/*/trades*', empty);
        await page.route('**/spot/accounts/*/orders/history*', empty);
        await page.route('**/spot/accounts/*/orders?*', emptyOrders);
        await page.route('**/spot/accounts/*/balances*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(frozen) }));
      });
      await s.page.getByTestId('amount').fill('8');
      await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
      await s.page.getByTestId('place-order').click();
      await s.page.locator('[data-testid=outcome][data-state=unknown]').waitFor({ timeout: 90000 });
      const text = await s.page.getByTestId('outcome').innerText();
      record('S17 no source can settle it: says "not confirmed", warns not to resend, never says it failed', /not confirmed/i.test(text) && /do not send it again/i.test(text) && !NO_OLD_COPY.test(text) && !/not filled/i.test(text), text.replace(/\s+/g, ' '));
      await shot(s.page, '20-confirm-unknown');
      await s.finish();
    }

    // S18: the stranded-dust bug. A minimum BTC buy leaves a holding that cannot be sold.
    {
      const s = await session();
      const ask = Number((await reader.spot.orderbook('TESTBTC_vUSDC', 5)).data?.asks?.[0]?.[0] ?? (await reader.spot.orderbook('BTC_vUSDC', 5)).data?.asks?.[0]?.[0] ?? 0);
      await s.page.getByTestId('amount').fill('6');
      await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
      const previewText = await s.page.getByTestId('preview').innerText();
      const qty = Number(previewText.match(/^([0-9.]+) BTC/)?.[1]);
      const warned = (await s.page.getByTestId('preview-warning').count()) === 1;
      // Cross-check against first principles: after the buy fee, can the holding be sold?
      const afterFee = qty * (1 - 0.00065);
      const heldSteps = Math.floor(afterFee / 0.00001 + 1e-9) * 0.00001;
      const price = Number(previewText.match(/at \$([0-9,.]+)/)?.[1].replace(/,/g, ''));
      const sellable = heldSteps * price >= 5 && heldSteps >= 0.00001;
      record('S18a the dust warning appears exactly when a buy could not be sold back (cross-checked from first principles)', warned === !sellable, `qty=${qty} price=${price} sellable=${sellable} warned=${warned} ask=${ask}`);
      if (warned) {
        const warning = await s.page.getByTestId('preview-warning').innerText();
        record('S18b the warning names the holding after the fee and offers a fix', /could not sell it back/i.test(warning) && (await s.page.getByTestId('use-suggested').count()) === 1, warning.replace(/\s+/g, ' '));
        await shot(s.page, '21-dust-warning');
        await s.page.getByTestId('use-suggested').click();
        await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
        await sleep(800);
        record('S18c taking the suggestion removes the warning', (await s.page.getByTestId('preview-warning').count()) === 0, await s.page.getByTestId('preview').innerText());
      }
      await s.finish();
    }

    // S19: selling. "Sell all I can" sells the most that is sellable, and a holding that is too small is explained.
    {
      const s = await session();
      await s.page.getByTestId('side-SELL').click();
      const holdText = await s.page.getByTestId('holding').innerText();
      const held = Number(holdText.match(/You hold ([0-9.]+)/)?.[1]);
      await s.page.getByTestId('sell-max').waitFor({ timeout: 15000 });
      await s.page.getByTestId('sell-max').click();
      await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
      const sellQty = Number((await s.page.getByTestId('preview').innerText()).match(/^([0-9.]+) BTC/)?.[1]);
      const wantMax = Math.floor(held / 0.00001 + 1e-9) * 0.00001;
      record('S19a "Sell all I can" sells the whole sellable holding, rounded down to a step', Math.abs(sellQty - wantMax) < 1e-9, `held=${held} sells=${sellQty} wanted=${wantMax}`);
      record('S19b the order is allowed (the holding is sellable)', !(await s.page.getByTestId('place-order').isDisabled()));
      await shot(s.page, '22-sell-max');
      await s.finish();
    }

    // S20: a stale preview can never be acted on.
    {
      const s = await session();
      await s.page.getByTestId('amount').fill('6');
      await s.page.getByTestId('preview').getByText(/BTC at/).waitFor({ timeout: 10000 });
      await s.page.getByTestId('amount').fill('12');
      const staleNow = await s.page.getByTestId('preview').getAttribute('data-fresh');
      const disabledNow = await s.page.getByTestId('place-order').isDisabled();
      record('S20a right after the amount changes the old quote is marked stale and the order is locked', staleNow === 'no' && disabledNow, `fresh=${staleNow} disabled=${disabledNow}`);
      await s.page.locator('[data-testid=preview][data-fresh=yes]').waitFor({ timeout: 10000 });
      const fresh = await s.page.getByTestId('preview').innerText();
      const q12 = Number(fresh.match(/^([0-9.]+) BTC/)?.[1]);
      const p12 = Number(fresh.match(/at \$([0-9,.]+)/)?.[1].replace(/,/g, ''));
      record('S20b once fresh, the quote matches the new amount', q12 * p12 <= 12.01 && q12 * p12 >= 11, `qty=${q12} price=${p12} value=${q12 * p12}`);
      await s.finish();
    }

    // S21: perps leverage. Set 5x, open a long, read the leverage back from the gateway; then a short at 3x.
    {
      const s = await session();
      await s.page.getByTestId('tab-perps').click();
      await s.page.locator('[role=option][data-label="ETH-USD"]').click();
      await s.page.getByTestId('leverage').waitFor({ timeout: 10000 });
      const defaultSel = await s.page.locator('[data-testid=leverage] [aria-checked=true]').getAttribute('data-leverage');
      const marketInit = Number((await reader.perps.symbols()).data.find((x) => x.name === 'ETH-USD').initLeverage);
      record('S21a the leverage selector starts at the market default', Number(defaultSel) === marketInit, `selected=${defaultSel} initLeverage=${marketInit}`);
      await s.page.locator('[data-testid=leverage] [data-leverage="5"]').click();
      await s.page.getByTestId('amount').fill('15');
      await s.page.getByTestId('preview').getByText(/Margin about/).waitFor({ timeout: 10000 });
      const marginText = await s.page.getByTestId('preview').innerText();
      record('S21b the ticket shows the margin the order needs at the chosen leverage', /Margin about \$[23]\.\d\d at 5x leverage/.test(marginText), marginText.replace(/\s+/g, ' '));
      await shot(s.page, '23-leverage');
      await s.page.getByTestId('place-order').click();
      await s.page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
      await sleep(1500);
      const pos = (await reader.perps.positions(funded.address)).data.positions.find((p) => p.symbol === 'ETH-USD' && Number(p.size) !== 0);
      record('S21c the gateway shows the position at exactly the leverage chosen', Number(pos?.leverage) === 5 && Number(pos?.size) > 0, `leverage=${pos?.leverage} size=${pos?.size} mode=${pos?.marginMode}`);
      await s.page.getByRole('button', { name: 'Close' }).first().click();
      await s.page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
      await sleep(1500);
      // Short at 3x.
      await s.page.getByTestId('side-SELL').click();
      await s.page.locator('[data-testid=leverage] [data-leverage="3"]').click();
      await s.page.getByTestId('amount').fill('15');
      await s.page.getByTestId('preview').getByText(/Margin about/).waitFor({ timeout: 10000 });
      await s.page.getByTestId('place-order').click();
      await s.page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
      await sleep(1500);
      const short = (await reader.perps.positions(funded.address)).data.positions.find((p) => p.symbol === 'ETH-USD' && Number(p.size) !== 0);
      record('S21d a perps short opens at the leverage chosen (3x), with a negative size', Number(short?.leverage) === 3 && Number(short?.size) < 0, `leverage=${short?.leverage} size=${short?.size}`);
      await s.page.getByRole('button', { name: 'Close' }).first().click();
      await s.page.locator('[data-testid=outcome][data-state=filled]').waitFor({ timeout: 70000 });
      await sleep(1500);
      const left = (await reader.perps.positions(funded.address)).data.positions.filter((p) => Number(p.size) !== 0);
      record('S21e both positions are closed on the gateway', left.length === 0, JSON.stringify(left));
      await s.finish();
    }

    // S22: margin too small for the order: explained, with the way out, and the order is locked.
    {
      const s = await session();
      await s.page.getByTestId('tab-perps').click();
      await s.page.locator('[role=option][data-label="ETH-USD"]').click();
      await s.page.locator('[data-testid=leverage] [data-leverage="1"]').click();
      await s.page.getByTestId('amount').fill('900');
      await s.page.getByTestId('preview').getByText(/needs about/i).waitFor({ timeout: 10000 });
      const t = await s.page.getByTestId('preview').innerText();
      record('S22 not enough margin: explains the shortfall and the way out, and locks the order', /Raise leverage/.test(t) && (await s.page.getByTestId('place-order').isDisabled()), t.replace(/\s+/g, ' '));
      await shot(s.page, '24-margin-shortfall');
      await s.finish();
    }
  }

  // S10 reload: the stored key survives, reconnect goes straight to the trade view.
  await page.reload();
  await page.getByTestId('wallet-POD Test Wallet').click();
  await page.getByTestId('place-order').waitFor({ timeout: 20000 });
  record('S10 reload and reconnect: no second signature needed', state.signed.filter((s) => s.primary === 'AddAPIKeyWithBuilder').length === 1);

  // S9 mobile layout.
  await context.close();
  {
    const m = await newPage(browser, { account: funded, viewport: { width: 390, height: 844 } });
    await m.page.goto(`${BASE}/trade`);
    await shot(m.page, '11-mobile-connect');
    await m.page.getByTestId('wallet-POD Test Wallet').click();
    await m.page.getByTestId('enable-trading').waitFor({ timeout: 20000 });
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    record('S9 mobile (390px): no horizontal overflow on the enable view', !overflow);
    const enableCard = await m.page.getByText('Enable POD trading: one signature').boundingBox();
    const accountCard = await m.page.getByText('Account', { exact: true }).first().boundingBox();
    record('S9b mobile: the enable card uses the full width (not squeezed into a sliver)', !!enableCard && enableCard.width >= 280, JSON.stringify(enableCard));
    record('S9c mobile: the account card sits below the enable card, not beside it', !!enableCard && !!accountCard && accountCard.y > enableCard.y + 100, JSON.stringify({ enableCard, accountCard }));
    await shot(m.page, '12-mobile-enable');
    await m.page.getByTestId('enable-trading').click();
    await m.page.getByTestId('place-order').waitFor({ timeout: 40000 });
    await m.page.locator('[role=option][data-label="BTC/USDC"]').click();
    await m.page.getByTestId('pod-read').waitFor({ timeout: 45000 });
    const overflow2 = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const ticket = await m.page.getByTestId('place-order').boundingBox();
    record('S9d mobile ready view: no horizontal overflow and the order button is full width', !overflow2 && !!ticket && ticket.width >= 280, JSON.stringify(ticket));
    await shot(m.page, '13-mobile-ready');
    await m.context.close();
  }

  await restoreBuilderFloor();

  // S23/S24: the key-slot lockout found while writing these tests. Fill the account to SoDEX's 10-key cap with keys POD
  // made, then enable trading in a fresh browser. The page must explain it and offer the way out. The first round's
  // oldest key is an ORPHAN that exists on ONE engine only (a half-applied registration), the second round's is a
  // normal two-engine key, so both kinds of victim are exercised.
  {
    await resetAccount(accountID);
    const mk = (name) => reader.public.addApiKey(funded.address, { network: 'testnet', accountID, name, publicKey: privateKeyToAccount(generatePrivateKey()).address }, (q) => funded.signTypedData(q));
    const master = SoDEX.fromPrivateKey(pk, 'testnet');
    const stamp = Date.now();
    const made = [];
    const list = () => reader.public.apiKeys(funded.address, accountID);
    const fullness = (k) => Math.max(k.spot.length, k.perps.length);

    // Build the orphan deterministically: register a key everywhere, then remove it from SPOT only.
    const orphan = `pod-85987d-${(stamp - 9_000_000).toString(36)}-orph`;
    await mk(orphan);
    await sleep(1200);
    await master.spot.revokeAPIKey({ accountID, name: orphan });
    await sleep(1500);
    let keys = await list();
    const orphanEngines = enginesHolding(keys, orphan);
    record('S23-setup an orphan key exists on exactly one engine (perps), as a half-failed registration leaves it', orphanEngines.length === 1 && orphanEngines[0] === 'perps', JSON.stringify(orphanEngines));
    made.push(orphan);
    for (let i = 0; fullness(keys) < 10 && i < 12; i++) {
      const name = `pod-85987d-${(stamp - 5_000_000 + i * 1000).toString(36)}-${i}`;
      await mk(name);
      made.push(name);
      await sleep(900);
      keys = await list();
    }
    const round = async (label, shotName) => {
      const before = await list();
      const victim = pickKeyToRemove(before, 'pod-');
      const engines = enginesHolding(before, victim.name);
      const s = await newPage(browser, { account: funded });
      await s.page.goto(`${BASE}/trade`);
      await s.page.getByTestId('wallet-POD Test Wallet').click();
      await s.page.getByTestId('enable-trading').waitFor({ timeout: 25000 });
      await s.page.getByTestId('enable-trading').click();
      await s.page.getByTestId('key-limit').waitFor({ timeout: 30000 });
      const limitText = await s.page.getByTestId('key-limit').innerText();
      record(`${label}a at the cap the page explains the lockout and names the key it will remove (${victim.name})`, /out of API key slots/i.test(limitText) && limitText.includes(victim.name), limitText.replace(/\s+/g, ' ').slice(0, 260));
      record(`${label}b no signature was requested just to be told there is no room`, s.state.signed.length === 0, JSON.stringify(s.state.signed));
      await shot(s.page, shotName);
      return { s, victim, engines, before };
    };
    const finishRound = async (label, r, extra) => {
      const { s, victim, engines } = r;
      await s.page.getByTestId('free-slot').click();
      await s.page.getByTestId('place-order').waitFor({ timeout: 90000 });
      const after = await list();
      const gone = enginesHolding(after, victim.name).length === 0;
      const newPod = allKeys(after).filter((k) => /^pod-/.test(k.name) && !made.includes(k.name));
      record(`${label}c the chosen key is gone from EVERY engine that held it and a new key took a slot`, gone && newPod.length === 1 && fullness(after) === 10, `gone=${gone} newKeys=${newPod.length} spot=${after.spot.length} perps=${after.perps.length}`);
      const want = [...engines.map((e) => `ExchangeAction:${e === 'spot' ? 'spot' : 'futures'}:138565`), 'AddAPIKeyWithBuilder:universal:138565'].join(' > ');
      const seq = s.state.signed.map((x) => `${x.primary}:${x.domain}:${x.domainChainId}`).join(' > ');
      record(`${label}d the wallet moved to the SoDEX chain and signed once per engine that held the key (${engines.join('+')}), then the enable, staying connected`, s.state.switches.includes('0x21d45') && seq === want, `${JSON.stringify(s.state.switches)} :: ${seq} (wanted ${want})`);
      const ap = await reader.public.approvalFor(funded.address, BUILDER_ID);
      record(`${label}e trading is enabled afterwards: fee approval on both engines`, ap.approvedBothEngines, JSON.stringify(ap));
      if (extra) await shot(s.page, extra);
      await s.context.close();
      made.push(...newPod.map((k) => k.name));
    };

    // Round 1: the orphan (one engine) is the oldest. Decline the switch first, then accept.
    const r1 = await round('S23', '25-key-limit');
    r1.s.state.rejectSwitch = true;
    await r1.s.page.getByTestId('free-slot').click();
    await r1.s.page.getByTestId('error').waitFor({ timeout: 15000 });
    const declined = await r1.s.page.getByTestId('error').innerText();
    const stillThere = enginesHolding(await list(), r1.victim.name).length > 0;
    record('S24 declining the network switch: friendly message, no key removed, the way out is still offered', /declined/i.test(declined) && stillThere && (await r1.s.page.getByTestId('free-slot').count()) === 1, `${declined} | victimStillThere=${stillThere}`);
    r1.s.state.rejectSwitch = false;
    await finishRound('S23', r1, '26-key-limit-recovered');

    // Round 2: the account is full again; now the oldest is an ordinary two-engine key.
    keys = await list();
    if (fullness(keys) < 10) {
      for (let i = 0; fullness(keys) < 10 && i < 12; i++) {
        await mk(`pod-85987d-${(stamp - 4_000_000 + i * 1000).toString(36)}-r${i}`);
        await sleep(900);
        keys = await list();
      }
    }
    const r2 = await round('S23-2', '25b-key-limit-normal');
    await finishRound('S23-2', r2, null);
  }

  // S25: the builder account is below SoDEX's 100 vUSDC floor. New sign-ups would be refused by the gateway,
  // so the page must say so up front and not ask for a signature that cannot work.
  {
    await resetAccount(accountID);
    const s = await newPage(browser, { account: funded });
    await s.page.route('**/spot/accounts/*/balances*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 0, data: { balances: [{ id: 0, coin: 'vUSDC', total: '50', locked: '0' }] } }) }));
    await s.page.goto(`${BASE}/trade`);
    await s.page.getByTestId('wallet-POD Test Wallet').click();
    await s.page.getByTestId('builder-paused').waitFor({ timeout: 25000 });
    const bannerText = await s.page.getByTestId('builder-paused').innerText();
    const locked = await s.page.getByTestId('enable-trading').isDisabled();
    record('S25 builder below the 100 USDC floor: sign-ups are paused up front, with the reason, and no signature is asked for', /paused/i.test(bannerText) && /already enabled, trading is not affected/i.test(bannerText) && locked && s.state.signed.length === 0, `${bannerText.replace(/\s+/g, ' ')} | locked=${locked}`);
    await shot(s.page, '27-builder-paused');
    await s.context.close();

    const h = await fetch(`${BASE}/api/builder-health`);
    const hj = await h.json();
    record('S26 /api/builder-health reports the builder balances and answers 200 when healthy', h.status === (hj.ok ? 200 : 503) && typeof hj.spot === 'number' && typeof hj.perps === 'number' && hj.floor === 100, JSON.stringify(hj));
  }

  // Cleanup: clear the approval and revoke the keys this run registered.
  await resetAccount(accountID);
  const final = await reader.public.approvalFor(funded.address, BUILDER_ID);
  record('cleanup: approval cleared on both engines', !final.spot && !final.perps, JSON.stringify(final));

  record('zero console errors, page errors or failed requests across every scenario', consoleProblems.length === 0, consoleProblems.slice(0, 6).join(' || '));
  await browser.close();

  console.log('\n==== SUMMARY ====');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`FAILED: ${f.name} -> ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('e2e error:', e);
  process.exit(2);
});
