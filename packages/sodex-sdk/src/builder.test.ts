import { describe, it, expect } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { hexToBytes, recoverTypedDataAddress, bytesToHex, type Hex } from 'viem';
import {
  BUILDER_FEE_CAP,
  UNIVERSAL_TYPES,
  addApiKeyTypedData,
  approveBuilderFeeTypedData,
  assertBuilderParams,
  bpToFeeUnits,
  builderEligibility,
  toUniversalSignature,
  toWireBuilder,
  universalDomain,
  universalHeaders,
} from './builder.js';
import { actionJson, payloadHash } from './signing.js';
import { SpotAPI } from './spot.js';
import { PerpsAPI } from './perps.js';
import { PublicAPI } from './public.js';
import type { SoDEXClient } from './client.js';

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(KEY);

/** Rebuilds the "TypeName(type name,...)" string SoDEX documents for each action. */
function typeString(name: keyof typeof UNIVERSAL_TYPES): string {
  return `${name}(${UNIVERSAL_TYPES[name].map((f) => `${f.type} ${f.name}`).join(',')})`;
}

describe('universal EIP-712 type strings', () => {
  // Copied verbatim from the Builder Codes page. Field order is part of the signature.
  it('ApproveBuilderFeeAction matches the documented string', () => {
    expect(typeString('ApproveBuilderFeeAction')).toBe(
      'ApproveBuilderFeeAction(uint64 chainID,uint64 nonce,uint64 accountID,uint64 builderID,uint64 maxFeeRate)',
    );
  });
  it('AddAPIKey matches the documented string', () => {
    expect(typeString('AddAPIKey')).toBe(
      'AddAPIKey(uint64 accountID,string name,uint8 keyType,bytes publicKey,uint64 expiresAt,uint64 nonce)',
    );
  });
  it('AddAPIKeyWithBuilder matches the documented string', () => {
    expect(typeString('AddAPIKeyWithBuilder')).toBe(
      'AddAPIKeyWithBuilder(uint64 chainID,uint64 nonce,uint64 accountID,string name,uint8 keyType,bytes publicKey,uint64 expiresAt,uint64 builderID,uint64 maxFeeRate)',
    );
  });
});

describe('universal domain', () => {
  it('uses the universal domain and the network chain id', () => {
    expect(universalDomain('mainnet')).toEqual({
      name: 'universal',
      version: '1',
      chainId: 286623,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    });
    expect(universalDomain('testnet').chainId).toBe(138565);
  });

  it('puts the same chain id in the header, the domain and the message', () => {
    for (const network of ['mainnet', 'testnet'] as const) {
      const { request, nonce } = approveBuilderFeeTypedData({
        network, accountID: 7, builderID: 235300, maxFeeRate: 100,
      });
      const headers = universalHeaders(network, ('0x' + '11'.repeat(64) + '1b') as Hex, nonce);
      expect(headers['X-API-Chain']).toBe(String(request.domain.chainId));
      expect(request.message.chainID).toBe(BigInt(request.domain.chainId as number));
    }
  });
});

describe('wallet-chain domain override', () => {
  it('signs with the wallet chain while the message stays bound to the SoDEX network', async () => {
    const { request, nonce } = approveBuilderFeeTypedData({
      network: 'mainnet', domainChainId: 1, accountID: 7, builderID: 235300, maxFeeRate: 100,
    });
    expect(request.domain.chainId).toBe(1);
    expect(request.message.chainID).toBe(286623n);
    const sig = await account.signTypedData(request as never);
    expect(await recoverTypedDataAddress({ ...(request as never), signature: sig })).toBe(account.address);
    expect(universalHeaders('mainnet', sig, nonce, 1)['X-API-Chain']).toBe('1');
    expect(universalHeaders('mainnet', sig, nonce)['X-API-Chain']).toBe('286623');
  });

  it('applies to key registration with a builder', () => {
    const { request } = addApiKeyTypedData({
      network: 'testnet', domainChainId: 8453, accountID: 1, name: 'k1',
      publicKey: '0x3d4595c8742d0a58173a9963c05755b59a8f8256', builder: { id: 5, fee: 100 },
    });
    expect(request.domain.chainId).toBe(8453);
    expect(request.message.chainID).toBe(138565n);
  });
});

describe('approveBuilderFeeTypedData', () => {
  it('builds the message in the documented order and a matching REST body', () => {
    const { request, body, nonce } = approveBuilderFeeTypedData({
      network: 'mainnet', accountID: 42, builderID: 235300, maxFeeRate: 100, nonce: 1760373925000n,
    });
    expect(Object.keys(request.message)).toEqual(['chainID', 'nonce', 'accountID', 'builderID', 'maxFeeRate']);
    expect(nonce).toBe(1760373925000n);
    expect(request.message).toEqual({
      chainID: 286623n, nonce: 1760373925000n, accountID: 42n, builderID: 235300n, maxFeeRate: 100n,
    });
    expect(body).toEqual({ accountID: 42, builderID: 235300, maxFeeRate: 100 });
  });

  it('signs so that the master wallet is the recoverable signer', async () => {
    const { request } = approveBuilderFeeTypedData({
      network: 'testnet', accountID: 42, builderID: 235300, maxFeeRate: 100,
    });
    const sig = await account.signTypedData(request as never);
    const recovered = await recoverTypedDataAddress({ ...(request as never), signature: sig });
    expect(recovered).toBe(account.address);
  });

  it('allows 0 to clear and rejects out-of-range rates and a zero builder', () => {
    expect(() => approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: 0 })).not.toThrow();
    expect(() => approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: 2001 })).toThrow(RangeError);
    expect(() => approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: -1 })).toThrow(RangeError);
    expect(() => approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: 1.5 })).toThrow(RangeError);
    expect(() => approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 0, maxFeeRate: 10 })).toThrow(RangeError);
  });

  it('never repeats a nonce', () => {
    const a = approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: 10 }).nonce;
    const b = approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: 10 }).nonce;
    expect(b > a).toBe(true);
  });
});

describe('toUniversalSignature', () => {
  it('prefixes 0x02 and normalises v from 27/28 to 0/1', async () => {
    const { request } = approveBuilderFeeTypedData({ network: 'mainnet', accountID: 1, builderID: 2, maxFeeRate: 10 });
    const raw = await account.signTypedData(request as never);
    const rawBytes = hexToBytes(raw);
    expect([27, 28]).toContain(rawBytes[64]);
    const wire = hexToBytes(toUniversalSignature(raw));
    expect(wire.length).toBe(66);
    expect(wire[0]).toBe(2);
    expect([0, 1]).toContain(wire[65]);
    expect(wire[65]).toBe(rawBytes[64]! - 27);
    expect(bytesToHex(wire.slice(1, 65))).toBe(bytesToHex(rawBytes.slice(0, 64)));
  });

  it('passes through a v that is already 0 or 1', () => {
    const sig = ('0x' + '22'.repeat(64) + '01') as Hex;
    expect(hexToBytes(toUniversalSignature(sig))[65]).toBe(1);
  });

  it('rejects a wrong length and an impossible v', () => {
    expect(() => toUniversalSignature('0x1234')).toThrow();
    expect(() => toUniversalSignature(('0x' + '22'.repeat(64) + '05') as Hex)).toThrow();
  });
});

describe('addApiKeyTypedData', () => {
  const publicKey = '0x3d4595c8742d0a58173a9963c05755b59a8f8256' as const;

  it('signs the plain AddAPIKey form when there is no builder', () => {
    const { request, body } = addApiKeyTypedData({
      network: 'mainnet', accountID: 1010, name: 'api-key-01', publicKey, nonce: 1760373925000n,
    });
    expect(request.primaryType).toBe('AddAPIKey');
    expect(Object.keys(request.message)).toEqual(['accountID', 'name', 'keyType', 'publicKey', 'expiresAt', 'nonce']);
    expect(body).toEqual({ accountID: 1010, name: 'api-key-01', type: 1, publicKey, expiresAt: 0 });
    expect('builder' in body).toBe(false);
  });

  it('signs AddAPIKeyWithBuilder and sends builder in the body', () => {
    const { request, body } = addApiKeyTypedData({
      network: 'mainnet', accountID: 1010, name: 'api-key-01', publicKey,
      builder: { id: 235300, fee: 100 }, nonce: 1760373925000n,
    });
    expect(request.primaryType).toBe('AddAPIKeyWithBuilder');
    expect(Object.keys(request.message)).toEqual([
      'chainID', 'nonce', 'accountID', 'name', 'keyType', 'publicKey', 'expiresAt', 'builderID', 'maxFeeRate',
    ]);
    expect(request.message.builderID).toBe(235300n);
    expect(request.message.maxFeeRate).toBe(100n);
    expect(body.builder).toEqual({ id: 235300, fee: 100 });
  });

  it('rejects bad key names, bad addresses and a zero builder', () => {
    const base = { network: 'mainnet', accountID: 1, publicKey } as const;
    expect(() => addApiKeyTypedData({ ...base, name: '' })).toThrow(RangeError);
    expect(() => addApiKeyTypedData({ ...base, name: 'a'.repeat(37) })).toThrow(RangeError);
    expect(() => addApiKeyTypedData({ ...base, name: 'has space' })).toThrow(RangeError);
    expect(() => addApiKeyTypedData({ ...base, name: 'ok', publicKey: '0x12' as Hex })).toThrow(RangeError);
    expect(() => addApiKeyTypedData({ ...base, name: 'ok', builder: { id: 0, fee: 10 } })).toThrow(RangeError);
  });
});

describe('builder fee validation', () => {
  it('converts basis points to tenths and refuses sub-resolution values', () => {
    expect(bpToFeeUnits(5)).toBe(50);
    expect(bpToFeeUnits(10)).toBe(100);
    expect(bpToFeeUnits(0.5)).toBe(5);
    expect(() => bpToFeeUnits(0.05)).toThrow(RangeError);
    expect(() => bpToFeeUnits(-1)).toThrow(RangeError);
    expect(() => bpToFeeUnits(Number.NaN)).toThrow(RangeError);
  });

  it('enforces the engine caps: spot 2000, perps 200', () => {
    expect(BUILDER_FEE_CAP).toEqual({ spot: 2000, perps: 200 });
    expect(() => assertBuilderParams({ id: 1, fee: 2000 }, 'spot')).not.toThrow();
    expect(() => assertBuilderParams({ id: 1, fee: 2001 }, 'spot')).toThrow(RangeError);
    expect(() => assertBuilderParams({ id: 1, fee: 200 }, 'perps')).not.toThrow();
    expect(() => assertBuilderParams({ id: 1, fee: 201 }, 'perps')).toThrow(RangeError);
  });

  it('rejects a zero builder, a fractional fee and a negative fee', () => {
    expect(() => assertBuilderParams({ id: 0, fee: 10 }, 'spot')).toThrow(RangeError);
    expect(() => assertBuilderParams({ id: 1n, fee: 1.5 }, 'spot')).toThrow(RangeError);
    expect(() => assertBuilderParams({ id: 1, fee: -1 }, 'spot')).toThrow(RangeError);
  });

  it('keeps the wire id an unquoted integer even when given a bigint', () => {
    const wire = toWireBuilder({ id: 235300n, fee: 100 });
    expect(actionJson({ builder: wire })).toBe('{"builder":{"id":235300,"fee":100}}');
    expect(() => toWireBuilder({ id: 2n ** 60n, fee: 1 })).toThrow(RangeError);
  });
});

/** Captures what the engines would sign and send, without any network. */
function fakeClient() {
  const calls: Array<{ domain: string; path: string; payload: { type: string; params: unknown } }> = [];
  const client = {
    spotBase: '/api/v1/spot',
    perpsBase: '/api/v1/perps',
    postSigned: async (domain: string, path: string, payload: { type: string; params: unknown }) => {
      calls.push({ domain, path, payload });
      return { code: 0 };
    },
  } as unknown as SoDEXClient;
  return { client, calls };
}

describe('order payloads carry the builder as the last field', () => {
  const order = {
    symbolID: 1, clOrdID: 'a1', side: 'BUY' as const, type: 'MARKET' as const,
    timeInForce: 'IOC' as const, funds: '5',
  };

  it('spot: builder follows orders, id before fee', async () => {
    const { client, calls } = fakeClient();
    await new SpotAPI(client).batchNewOrder({ accountID: 9, orders: [order], builder: { id: 235300, fee: 100 } });
    const json = actionJson(calls[0]!.payload);
    expect(json).toBe(
      '{"type":"batchNewOrder","params":{"accountID":9,"orders":[{"symbolID":1,"clOrdID":"a1","side":1,"type":2,"timeInForce":3,"funds":"5"}],"builder":{"id":235300,"fee":100}}}',
    );
  });

  it('spot: with no builder the key is absent and the hash differs', async () => {
    const { client, calls } = fakeClient();
    const api = new SpotAPI(client);
    await api.batchNewOrder({ accountID: 9, orders: [order] });
    await api.batchNewOrder({ accountID: 9, orders: [order], builder: { id: 235300, fee: 100 } });
    expect(actionJson(calls[0]!.payload)).not.toContain('builder');
    expect(payloadHash(calls[0]!.payload)).not.toBe(payloadHash(calls[1]!.payload));
  });

  it('spot: refuses an over-cap builder before signing anything', async () => {
    const { client, calls } = fakeClient();
    await expect(
      Promise.resolve().then(() =>
        new SpotAPI(client).batchNewOrder({ accountID: 9, orders: [order], builder: { id: 1, fee: 2001 } }),
      ),
    ).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  it('perps: builder follows orders, and the perps cap is 200', async () => {
    const { client, calls } = fakeClient();
    const api = new PerpsAPI(client);
    await api.newOrder({
      accountID: 9, symbolID: 1,
      orders: [{ clOrdID: 'p1', modifier: 1, side: 1, type: 2, timeInForce: 3, quantity: '0.001', reduceOnly: false, positionSide: 1 }],
      builder: { id: 235300, fee: 50 },
    });
    expect(actionJson(calls[0]!.payload)).toBe(
      '{"type":"newOrder","params":{"accountID":9,"symbolID":1,"orders":[{"clOrdID":"p1","modifier":1,"side":1,"type":2,"timeInForce":3,"quantity":"0.001","reduceOnly":false,"positionSide":1}],"builder":{"id":235300,"fee":50}}}',
    );
    expect(() =>
      api.newOrder({ accountID: 9, symbolID: 1, orders: [{}], builder: { id: 1, fee: 201 } }),
    ).toThrow(RangeError);
  });
});

describe('PublicAPI', () => {
  function pub(responses: Record<string, unknown>) {
    const requested: string[] = [];
    const client = {
      publicBase: '/api/v1',
      get: async (path: string) => {
        requested.push(path);
        const key = Object.keys(responses).find((k) => path.endsWith(k));
        if (!key) throw new Error(`unexpected request ${path}`);
        return responses[key];
      },
    } as unknown as SoDEXClient;
    return { api: new PublicAPI(client), requested };
  }
  const addr = '0x83240ae16af4c76637d51ab0ef2a42a8df776361';

  it('reads the primary account id, and null for an unactivated address', async () => {
    const a = pub({ '/subaccounts': { code: 0, data: { userID: 235300, primaryAccountID: 235300, subaccounts: [] } } });
    expect(await a.api.primaryAccountID(addr)).toBe(235300);
    const b = pub({ '/subaccounts': { code: 0, data: null } });
    expect(await b.api.primaryAccountID(addr)).toBeNull();
  });

  it('counts an approval only when BOTH engines hold it', async () => {
    const both = pub({ '/builders': { code: 0, data: { spot: [{ userID: 1, builderID: 235300, feeRate: 100 }], perps: [{ userID: 1, builderID: 235300, feeRate: 50 }] } } });
    expect(await both.api.approvalFor(addr, 235300)).toEqual({ spot: 100, perps: 50, approvedBothEngines: true });
    const one = pub({ '/builders': { code: 0, data: { spot: [{ userID: 1, builderID: 235300, feeRate: 100 }], perps: [] } } });
    expect((await one.api.approvalFor(addr, 235300)).approvedBothEngines).toBe(false);
    const other = pub({ '/builders': { code: 0, data: { spot: [{ userID: 1, builderID: 999, feeRate: 100 }], perps: [{ userID: 1, builderID: 999, feeRate: 100 }] } } });
    expect((await other.api.approvalFor(addr, 235300)).approvedBothEngines).toBe(false);
  });

  it('treats a null or empty builders payload as no approvals', async () => {
    const n = pub({ '/builders': { code: 0, data: null } });
    expect(await n.api.builders(addr)).toEqual({ spot: [], perps: [] });
  });

  it('rejects a malformed address before making any request', async () => {
    const a = pub({});
    await expect(a.api.subaccounts('not-an-address')).rejects.toThrow(RangeError);
    expect(a.requested).toHaveLength(0);
  });
});

describe('a freshly generated wallet round-trips through the approval signature', () => {
  it('recovers the right signer for random keys', async () => {
    for (let i = 0; i < 5; i++) {
      const acct = privateKeyToAccount(generatePrivateKey());
      const { request } = approveBuilderFeeTypedData({ network: 'mainnet', accountID: 100 + i, builderID: 235300, maxFeeRate: 100 });
      const sig = await acct.signTypedData(request as never);
      expect(await recoverTypedDataAddress({ ...(request as never), signature: sig })).toBe(acct.address);
    }
  });
});

describe('builderEligibility (new approvals are refused below 100 vUSDC in either engine)', () => {
  it('is eligible at or above the floor in both engines, including exactly 100', () => {
    expect(builderEligibility({ spot: 100, perps: 100 })).toEqual({ ok: true, shortfall: { spot: 0, perps: 0 } });
    expect(builderEligibility({ spot: 250.5, perps: 100.01 }).ok).toBe(true);
  });
  it('is NOT eligible when either engine is short, and says by how much', () => {
    expect(builderEligibility({ spot: 95.93, perps: 105.5 })).toMatchObject({ ok: false, shortfall: { perps: 0 } });
    expect(builderEligibility({ spot: 95.93, perps: 105.5 }).shortfall.spot).toBeCloseTo(4.07, 2);
    expect(builderEligibility({ spot: 101, perps: 99.99 }).ok).toBe(false);
    expect(builderEligibility({ spot: 0, perps: 0 }).shortfall).toEqual({ spot: 100, perps: 100 });
  });
  it('the live mainnet numbers at the time of writing are eligible, by a cent', () => {
    expect(builderEligibility({ spot: 101.043573821, perps: 100.01033068 }).ok).toBe(true);
  });
});
