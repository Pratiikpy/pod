/**
 * Live testnet check of API-key slot handling. Testnet only. Never prints keys.
 *
 *   1. A key registered with no builder is accepted (routed through a zero-rate builder form).
 *   2. Filling the account to the cap makes the next registration fail, and keySlots() saw it coming.
 *   3. pickKeyToRemove chooses the oldest of our keys; revoking it with a wallet-style signature
 *      (SoDEX chain id domain, one signature per engine) frees a slot on BOTH engines.
 *   4. Registering works again afterwards. Everything created here is removed at the end.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { SoDEX, MAX_API_KEYS, keySlots, pickKeyToRemove, type ApiKeyList } from '../src/index.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const pk = process.env['SODEX_PRIVATE_KEY'] as Hex | undefined;
if (!pk) throw new Error('SODEX_PRIVATE_KEY missing');
const master = privateKeyToAccount(pk);
const NETWORK = 'testnet' as const;
const PREFIX = 'kt-';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^.*\(code -1\): /, '').slice(0, 200);

async function main() {
  const api = SoDEX.publicOnly(NETWORK).public;
  const accountID = (await api.primaryAccountID(master.address))!;
  const sign = (r: unknown) => master.signTypedData(r as never);
  const list = async () => (await api.apiKeys(master.address, accountID)) as ApiKeyList;
  const mine = async () => ((await list()).spot ?? []).filter((k) => k.name.startsWith(PREFIX));
  const register = async (name: string) => api.addApiKey(master.address, { network: NETWORK, accountID, name, publicKey: privateKeyToAccount(generatePrivateKey()).address }, sign);
  const revokeBoth = async (name: string) => {
    for (const engine of ['spot', 'perps'] as const) await api.revokeApiKey(master.address, { network: NETWORK, engine, accountID, name }, sign);
  };
  const cleanup = async () => {
    for (const k of await mine()) await revokeBoth(k.name).catch(() => undefined);
    await sleep(1500);
  };
  const nameAt = (t: number, i: number) => `${PREFIX}${accountID}-${t.toString(36)}-${i}`.slice(0, 36);

  await cleanup();

  // 1. A key with no builder.
  const first = nameAt(Date.now() - 50_000, 0);
  try {
    await register(first);
    await sleep(1500);
    const both = await list();
    record('a key registered with no builder is accepted and appears on BOTH engines', !!both.spot?.some((k) => k.name === first) && !!both.perps?.some((k) => k.name === first), `spot=${both.spot?.length} perps=${both.perps?.length}`);
  } catch (e) {
    record('a key registered with no builder is accepted and appears on BOTH engines', false, msg(e));
  }

  // 2. Fill to the cap.
  let before = await list();
  let i = 1;
  while (!keySlots(before).full && i < 20) {
    await register(nameAt(Date.now() - 40_000 + i * 1000, i)).catch(() => undefined);
    await sleep(900);
    before = await list();
    i++;
  }
  const slots = keySlots(before);
  record('keySlots() reports the account as full at the cap', slots.full && slots.used === MAX_API_KEYS, JSON.stringify(slots));
  let refused = '';
  try {
    await register(nameAt(Date.now(), 99));
  } catch (e) {
    refused = msg(e);
  }
  record('the next registration is refused by the gateway for exactly that reason', /maximum number of API keys/i.test(refused), refused || 'ACCEPTED (unexpected)');

  // 3. Free the oldest of ours, wallet-style.
  const victim = pickKeyToRemove(before, PREFIX);
  record('pickKeyToRemove chooses the oldest key we created and never default or webkey', !!victim && victim.name === first, `chose ${victim?.name} (oldest created was ${first})`);
  if (victim) {
    await revokeBoth(victim.name);
    await sleep(1500);
    const after = await list();
    record('revoking with a SoDEX-chain wallet signature frees the slot on BOTH engines', !after.spot?.some((k) => k.name === victim.name) && !after.perps?.some((k) => k.name === victim.name) && keySlots(after).used === MAX_API_KEYS - 1, `spot=${after.spot?.length} perps=${after.perps?.length}`);
  }

  // 4. Register again.
  try {
    const again = nameAt(Date.now(), 100);
    await register(again);
    await sleep(1500);
    const now = await list();
    record('registering works again once a slot is free', !!now.spot?.some((k) => k.name === again) && !!now.perps?.some((k) => k.name === again), `spot=${now.spot?.length} perps=${now.perps?.length}`);
  } catch (e) {
    record('registering works again once a slot is free', false, msg(e));
  }

  await cleanup();
  const end = await list();
  record('cleanup left only the account\'s original keys', (end.spot ?? []).every((k) => !k.name.startsWith(PREFIX)), (end.spot ?? []).map((k) => k.name).join(','));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`FAILED: ${f.name} -> ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('script error:', e);
  process.exit(2);
});
