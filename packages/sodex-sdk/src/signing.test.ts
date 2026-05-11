import { describe, it, expect } from 'vitest';
import { actionJson, payloadHash, createSigner } from './signing.js';
import { privateKeyToAccount } from 'viem/accounts';

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

describe('actionJson', () => {
  it('preserves key insertion order', () => {
    const out = actionJson({ type: 'batchNewOrder', params: { accountID: 5, orders: [] } });
    expect(out).toBe('{"type":"batchNewOrder","params":{"accountID":5,"orders":[]}}');
  });

  it('strips null and undefined fields', () => {
    const out = actionJson({ a: 1, b: null, c: undefined, d: 'x' });
    expect(out).toBe('{"a":1,"d":"x"}');
  });

  it('serialises bigints as strings', () => {
    const out = actionJson({ accountID: 1234567890n, ts: 1n });
    expect(out).toBe('{"accountID":"1234567890","ts":"1"}');
  });
});

describe('payloadHash', () => {
  it('is deterministic', () => {
    const p = { type: 'batchNewOrder', params: { accountID: 1, orders: [] } };
    expect(payloadHash(p)).toBe(payloadHash(p));
  });

  it('changes when params change', () => {
    const a = { type: 'batchNewOrder', params: { accountID: 1, orders: [] } };
    const b = { type: 'batchNewOrder', params: { accountID: 2, orders: [] } };
    expect(payloadHash(a)).not.toBe(payloadHash(b));
  });
});

describe('createSigner', () => {
  it('returns the correct EVM address', () => {
    const account = privateKeyToAccount(TEST_KEY);
    const signer = createSigner({ account, chainId: 138565 });
    expect(signer.address).toBe(account.address);
  });

  it('produces a 66-byte typed signature with 0x01 prefix', async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const signer = createSigner({ account, chainId: 138565 });
    const result = await signer.sign(
      { type: 'batchNewOrder', params: { accountID: 1, orders: [] } },
      'spot',
    );
    expect(result.signature).toMatch(/^0x[0-9a-f]+$/);
    expect(result.nonce).toBeGreaterThan(0n);
    expect(result.signature.length).toBe(2 + 132);
    expect(result.signature.slice(0, 4)).toBe('0x01');
  });

  it('produces unique nonces on repeated calls', async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const signer = createSigner({ account, chainId: 138565 });
    const r1 = await signer.sign({ type: 'a', params: {} }, 'spot');
    const r2 = await signer.sign({ type: 'a', params: {} }, 'spot');
    expect(r1.nonce).not.toBe(r2.nonce);
  });

  it('different domain (spot vs perps) produces different signature for same payload+nonce', async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const signer = createSigner({
      account,
      chainId: 138565,
      nonceGenerator: () => 100n,
    });
    const spotSig = await signer.sign({ type: 'a', params: { x: 1 } }, 'spot');
    const perpsSig = await signer.sign({ type: 'a', params: { x: 1 } }, 'perps');
    expect(spotSig.signature).not.toBe(perpsSig.signature);
  });
});
