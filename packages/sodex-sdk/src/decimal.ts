/**
 * Canonical decimal strings, as SoDEX defines them: no plus sign, no exponent,
 * no leading zeros, no trailing zeros after the point. The signature hashes the
 * exact bytes, so "0.00020" and "0.0002" are different payloads and the gateway
 * rejects the first with "quantity is invalid".
 *
 * Source: REST schema, "Decimal String".
 */
export function canonicalDecimal(input: string | number): string {
  const raw = typeof input === 'number' ? numberToPlain(input) : input.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    throw new RangeError(`not a decimal number: ${JSON.stringify(input)}`);
  }
  const sign = m[1] === '-' ? '-' : '';
  let int = m[2] ?? '';
  let frac = m[3] ?? '';
  const exp = m[4] ? Number.parseInt(m[4], 10) : 0;
  if (exp > 0) {
    const pad = frac.padEnd(exp, '0');
    int += pad.slice(0, exp);
    frac = pad.slice(exp);
  } else if (exp < 0) {
    const pad = int.padStart(-exp, '0');
    frac = pad.slice(pad.length + exp) + frac;
    int = pad.slice(0, pad.length + exp);
  }
  int = int.replace(/^0+/, '') || '0';
  frac = frac.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return out === '0' ? '0' : sign + out;
}

/** Plain positional notation for a JS number (no exponent), up to 20 decimal places. */
function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`not a finite number: ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const [mant, e] = s.toLowerCase().split('e');
  return canonicalDecimal(`${mant}e${e}`);
}
