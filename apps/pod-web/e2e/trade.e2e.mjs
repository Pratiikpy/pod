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
import { SoDEX } from '@pod/sodex-sdk';

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

async function newPage(browser, { account, viewport = { width: 1280, height: 900 }, chainId = '0x1', wallet = true }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const state = { rejectNext: false, signed: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') consoleProblems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  // ERR_ABORTED is what a reload or a closing page does to an in-flight request, not a product failure.
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') consoleProblems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });

  if (wallet) {
    await page.exposeFunction('__podRpc', async (method, params) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return { result: [account.address] };
      if (method === 'eth_chainId') return { result: chainId };
      if (method === 'eth_signTypedData_v4') {
        if (state.rejectNext) {
          state.rejectNext = false;
          return { error: { code: 4001, message: 'User rejected the request.' } };
        }
        const typed = reviveTypedData(params[1]);
        state.signed.push({ primary: typed.primaryType, domainChainId: typed.domain.chainId });
        return { result: await account.signTypedData(typed) };
      }
      return { error: { code: -32601, message: `unsupported ${method}` } };
    });
    await page.addInitScript(() => {
      const provider = {
        request: async ({ method, params }) => {
          const r = await window.__podRpc(method, params);
          if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
          return r.result;
        },
        on() {},
        removeListener() {},
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
  for (const k of (remaining.spot ?? []).filter((x) => /^pod-/.test(x.name))) {
    for (const api of [masterOnly.spot, masterOnly.perps]) await api.revokeAPIKey({ accountID, name: k.name }).catch(() => {});
  }
  await sleep(1500);
}

async function main() {
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
  await page.getByTestId('pod-read').waitFor({ timeout: 45000 });
  const readText = await page.getByTestId('pod-read').innerText();
  record('S4-0 the POD Score and its reasoning are shown for the selected coin', /POD says (buy|reduce|hold) BTC/.test(readText), readText.replace(/\s+/g, ' ').slice(0, 200));
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
  await page.getByTestId('outcome').waitFor({ timeout: 30000 });
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
  const sellOutcome = await page.getByTestId('outcome').innerText();
  const sellTrade = (await reader.spot.userTrades(funded.address, { limit: 20 })).data.find((t) => !sellBefore.includes(t.tradeID) && t.side === 'SELL');
  const shownFee = Number(sellOutcome.match(/POD builder fee ([0-9.]+)/)?.[1] ?? NaN);
  const wantFee = sellTrade ? (Number(sellTrade.price) * Number(sellTrade.quantity) * 100) / 100000 : NaN;
  record('S5b SELL filled: builder fee on the page equals the gateway and equals 10 bp of notional', !!sellTrade && Number(sellTrade.builderFee) > 0 && Math.abs(Number(sellTrade.builderFee) - shownFee) < 1e-9 && Math.abs(Number(sellTrade.builderFee) - wantFee) <= wantFee * 0.05, `page=${shownFee} gateway=${sellTrade?.builderFee} expected~${wantFee}`);
  await shot(page, '08-sell-filled');

  // S8c selling something not held.
  await page.locator('[role=option][data-label="ETH/USDC"]').click();
  await page.getByText(/You hold no ETH to sell on spot/).waitFor({ timeout: 8000 }).then(
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
  const longWant = longTrade ? (Number(longTrade.price) * Number(longTrade.quantity) * 50) / 100000 : NaN;
  record('S6a perps long filled with a 5 bp builder fee', !!longTrade && Math.abs(Number(longTrade.builderFee) - longWant) <= longWant * 0.05, `gateway=${longTrade?.builderFee} expected~${longWant} page=${longOutcome.replace(/\n/g, ' | ')}`);
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
    const pick = testnetSpot.find((x) => /^TSLA/.test(x.displayName ?? '')) ?? testnetSpot[0];
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
