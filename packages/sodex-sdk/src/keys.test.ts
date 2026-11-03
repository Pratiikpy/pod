import { describe, it, expect } from 'vitest';
import { hexToBytes, recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MAX_API_KEYS, allKeys, enginesHolding, engineHeaders, keySlots, pickKeyToRemove, revokeApiKeyTypedData, toEngineSignature, type ApiKeyInfo } from './keys.js';
import { createSigner } from './signing.js';
import { PublicAPI } from './public.js';
import type { SoDEXClient } from './client.js';

const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const key = (name: string, expiresAt = 0): ApiKeyInfo => ({ name, expiresAt });
const t36 = (ms: number) => ms.toString(36);

describe('keySlots (the 10-key cap found on the live gateway)', () => {
  it('counts the fuller engine, because a key is added to both', () => {
    expect(MAX_API_KEYS).toBe(10);
    expect(keySlots({ spot: Array.from({ length: 4 }, (_, i) => key(`a${i}`)), perps: Array.from({ length: 6 }, (_, i) => key(`b${i}`)) })).toEqual({ used: 6, free: 4, full: false });
  });
  it('is full at ten and never reports negative room', () => {
    const ten = Array.from({ length: 10 }, (_, i) => key(`k${i}`));
    expect(keySlots({ spot: ten, perps: ten })).toEqual({ used: 10, free: 0, full: true });
    expect(keySlots({ spot: [...ten, key('x')], perps: ten }).free).toBe(0);
  });
  it('handles a missing or empty list', () => {
    expect(keySlots(null)).toEqual({ used: 0, free: 10, full: false });
    expect(keySlots({})).toEqual({ used: 0, free: 10, full: false });
  });
});

describe('pickKeyToRemove', () => {
  const now = 1_800_000_000_000;
  it('never touches keys the app did not create', () => {
    expect(pickKeyToRemove({ spot: [key('default'), key('webkey')] }, 'pod-', now)).toBeNull();
    expect(pickKeyToRemove({ spot: [] }, 'pod-', now)).toBeNull();
  });
  it('removes an expired key before any live one, even a newer one', () => {
    const keys = { spot: [key(`pod-aaaaaa-${t36(now - 9_000)}-1111`, now + 5_000), key(`pod-aaaaaa-${t36(now - 1_000)}-2222`, now - 1)] };
    expect(pickKeyToRemove(keys, 'pod-', now)?.name).toBe(`pod-aaaaaa-${t36(now - 1_000)}-2222`);
  });
  it('otherwise removes the oldest by the timestamp in its name', () => {
    const keys = { spot: [key(`pod-aaaaaa-${t36(now - 100)}-1111`), key(`pod-aaaaaa-${t36(now - 5_000)}-2222`), key(`pod-aaaaaa-${t36(now - 900)}-3333`)] };
    expect(pickKeyToRemove(keys, 'pod-', now)?.name).toBe(`pod-aaaaaa-${t36(now - 5_000)}-2222`);
  });
  it('treats keys from the old naming scheme (no timestamp) as the oldest', () => {
    const keys = { spot: [key(`pod-aaaaaa-${t36(now - 5_000)}-2222`), key('pod-85987d-e49880eb')] };
    expect(pickKeyToRemove(keys, 'pod-', now)?.name).toBe('pod-85987d-e49880eb');
  });
});

describe('orphan keys (a registration that landed on one engine only)', () => {
  const now = 1_800_000_000_000;
  it('allKeys merges both engines by name', () => {
    const merged = allKeys({ spot: [key('a'), key('b')], perps: [key('b'), key('c')] });
    expect(merged.map((k) => k.name).sort()).toEqual(['a', 'b', 'c']);
  });
  it('enginesHolding says where a key exists, so only those engines are asked to revoke it', () => {
    const keys = { spot: [key('a'), key('both')], perps: [key('both'), key('only-perps')] };
    expect(enginesHolding(keys, 'a')).toEqual(['spot']);
    expect(enginesHolding(keys, 'only-perps')).toEqual(['perps']);
    expect(enginesHolding(keys, 'both')).toEqual(['spot', 'perps']);
    expect(enginesHolding(keys, 'missing')).toEqual([]);
  });
  it('an orphan that exists only on perps can be chosen for removal (the live lockout case)', () => {
    const orphan = `pod-aaaaaa-${t36(now - 9_000)}-orph`;
    const keys = { spot: [key(`pod-aaaaaa-${t36(now - 100)}-1111`), key('default')], perps: [key(orphan), key(`pod-aaaaaa-${t36(now - 100)}-1111`), key('default')] };
    expect(pickKeyToRemove(keys, 'pod-', now)?.name).toBe(orphan);
  });
  it('keySlots counts the fuller engine, so a perps-only orphan can fill the account while spot looks fine', () => {
    const ten = Array.from({ length: 10 }, (_, i) => key(`k${i}`));
    expect(keySlots({ spot: ten.slice(0, 7), perps: ten }).full).toBe(true);
  });
});

describe('revokeApiKeyTypedData', () => {
  it('uses each engine its own domain name and the SoDEX chain id', () => {
    const spot = revokeApiKeyTypedData({ network: 'mainnet', engine: 'spot', accountID: 7, name: 'pod-x' });
    const perps = revokeApiKeyTypedData({ network: 'mainnet', engine: 'perps', accountID: 7, name: 'pod-x' });
    expect(spot.request.domain).toMatchObject({ name: 'spot', chainId: 286623 });
    expect(perps.request.domain).toMatchObject({ name: 'futures', chainId: 286623 });
    expect(revokeApiKeyTypedData({ network: 'testnet', engine: 'spot', accountID: 7, name: 'k' }).request.domain.chainId).toBe(138565);
    expect(spot.path).toBe('/api/v1/spot/accounts/api-keys');
    expect(perps.path).toBe('/api/v1/perps/accounts/api-keys');
    expect(spot.body).toEqual({ accountID: 7, name: 'pod-x' });
  });

  it('produces byte-for-byte the signature the existing engine signer produces (so the gateway will verify it)', async () => {
    const nonce = 1_760_373_925_000n;
    for (const engine of ['spot', 'perps'] as const) {
      const t = revokeApiKeyTypedData({ network: 'testnet', engine, accountID: 53229, name: 'pod-abc', nonce });
      const viaWalletPath = toEngineSignature(await account.signTypedData(t.request as never));
      const viaSdkSigner = await createSigner({ account, chainId: 138565, nonceGenerator: () => nonce }).sign(
        { type: 'revokeAPIKey', params: { accountID: 53229, name: 'pod-abc' } },
        engine,
      );
      expect(viaWalletPath).toBe(viaSdkSigner.signature);
    }
  });

  it('recovers the master wallet as the signer', async () => {
    const t = revokeApiKeyTypedData({ network: 'mainnet', engine: 'spot', accountID: 1, name: 'k' });
    const sig = await account.signTypedData(t.request as never);
    expect(await recoverTypedDataAddress({ ...(t.request as never), signature: sig })).toBe(account.address);
  });

  it('rejects names and ids the gateway would reject', () => {
    expect(() => revokeApiKeyTypedData({ network: 'mainnet', engine: 'spot', accountID: 0, name: 'k' })).toThrow(RangeError);
    expect(() => revokeApiKeyTypedData({ network: 'mainnet', engine: 'spot', accountID: 1, name: 'has space' })).toThrow(RangeError);
    expect(() => revokeApiKeyTypedData({ network: 'mainnet', engine: 'spot', accountID: 1, name: 'a'.repeat(37) })).toThrow(RangeError);
  });
});

describe('toEngineSignature', () => {
  it('prefixes 0x01 and normalises v to 0 or 1', () => {
    const wire = hexToBytes(toEngineSignature(('0x' + '33'.repeat(64) + '1c') as Hex));
    expect(wire[0]).toBe(1);
    expect(wire[65]).toBe(1);
    expect(hexToBytes(toEngineSignature(('0x' + '33'.repeat(64) + '1b') as Hex))[65]).toBe(0);
    expect(hexToBytes(toEngineSignature(('0x' + '33'.repeat(64) + '00') as Hex))[65]).toBe(0);
  });
  it('rejects a wrong length and an impossible v', () => {
    expect(() => toEngineSignature('0x12')).toThrow();
    expect(() => toEngineSignature(('0x' + '33'.repeat(64) + '07') as Hex)).toThrow();
  });
  it('sends the network chain id in the header', () => {
    expect(engineHeaders('mainnet', ('0x' + '33'.repeat(64) + '1b') as Hex, 5n)['X-API-Chain']).toBe('286623');
  });
});

describe('PublicAPI key calls', () => {
  function fake() {
    const posts: Array<{ path: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const deletes: Array<{ path: string; body: unknown; headers: Record<string, string> }> = [];
    const client = {
      publicBase: '/api/v1',
      postWithHeaders: async (path: string, body: Record<string, unknown>, headers: Record<string, string>) => {
        posts.push({ path, body, headers });
        return { code: 0, data: null };
      },
      deleteWithHeaders: async (path: string, body: unknown, headers: Record<string, string>) => {
        deletes.push({ path, body, headers });
        return { code: 0, data: null };
      },
    } as unknown as SoDEXClient;
    return { api: new PublicAPI(client), posts, deletes };
  }
  const addr = account.address;
  const pub = '0x3d4595c8742d0a58173a9963c05755b59a8f8256' as const;

  it('a key registered without a builder goes through the builder form with a zero rate (the gateway refuses the plain form)', async () => {
    const { api, posts } = fake();
    let typed: { primaryType?: string; message?: Record<string, unknown> } = {};
    await api.addApiKey(addr, { network: 'testnet', accountID: 53229, name: 'k1', publicKey: pub }, async (r) => {
      typed = r as never;
      return ('0x' + '11'.repeat(64) + '1b') as Hex;
    });
    expect(typed.primaryType).toBe('AddAPIKeyWithBuilder');
    expect(typed.message).toMatchObject({ builderID: 53229n, maxFeeRate: 0n });
    expect(posts[0]!.body['builder']).toEqual({ id: 53229, fee: 0 });
  });

  it('a key registered with a builder keeps the builder and its rate', async () => {
    const { api, posts } = fake();
    await api.addApiKey(addr, { network: 'testnet', accountID: 1, name: 'k1', publicKey: pub, builder: { id: 235300, fee: 100 } }, async () => ('0x' + '11'.repeat(64) + '1b') as Hex);
    expect(posts[0]!.body['builder']).toEqual({ id: 235300, fee: 100 });
  });

  it('revokeApiKey sends one DELETE to the right engine path with engine-style headers', async () => {
    const { api, deletes } = fake();
    await api.revokeApiKey(addr, { network: 'mainnet', engine: 'perps', accountID: 9, name: 'pod-x' }, (r) => account.signTypedData(r as never));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.path).toBe('/api/v1/perps/accounts/api-keys');
    expect(deletes[0]!.body).toEqual({ accountID: 9, name: 'pod-x' });
    expect(deletes[0]!.headers['X-API-Sign']!.startsWith('0x01')).toBe(true);
  });
});
