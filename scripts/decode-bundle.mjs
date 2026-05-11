/**
 * Decode the design bundle file: extract <script type="__bundler/template"> and
 * <script type="__bundler/manifest"> contents, base64-decode, gunzip, then write
 * each asset to disk so we can inspect the actual JSX/CSS.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';

const SRC = 'C:/Users/prate/Downloads/POD - standalone.html';
const OUT_DIR = 'C:/Users/prate/soso/design-source';

async function main() {
  const html = await readFile(SRC, 'utf8');

  const grab = (type) => {
    const re = new RegExp(`<script[^>]*type="__bundler/${type}"[^>]*>([\\s\\S]*?)<\\/script>`, 'i');
    const m = html.match(re);
    if (!m) throw new Error(`Missing script tag: __bundler/${type}`);
    return JSON.parse(m[1]);
  };

  const manifest = grab('manifest');
  const template = grab('template');

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`📦 Manifest entries: ${Object.keys(manifest).length}`);
  console.log(`📄 Template root: ${template.root ?? 'unknown'}\n`);
  await writeFile(resolve(OUT_DIR, '_template.json'), JSON.stringify(template, null, 2));
  await writeFile(
    resolve(OUT_DIR, '_manifest-summary.json'),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(manifest).map(([k, v]) => [
          k,
          { mime: v.mime, compressed: v.compressed, path: v.path, size: v.data?.length ?? 0 },
        ]),
      ),
      null,
      2,
    ),
  );

  const decoded = [];
  for (const [uuid, entry] of Object.entries(manifest)) {
    const buf = Buffer.from(entry.data, 'base64');
    const final = entry.compressed ? gunzipSync(buf) : buf;
    const path = entry.path ?? `${uuid}.${(entry.mime ?? 'bin').split('/')[1] ?? 'bin'}`;
    const cleanPath = path.replace(/^\/+/, '').replace(/[?#].*$/, '');
    const fullPath = resolve(OUT_DIR, cleanPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, final);
    decoded.push({ uuid, path: cleanPath, mime: entry.mime, bytes: final.length });
  }

  console.log('Decoded assets:');
  for (const a of decoded.sort((x, y) => y.bytes - x.bytes)) {
    console.log(`  ${a.bytes.toString().padStart(8)}  ${a.mime.padEnd(28)}  ${a.path}`);
  }
  console.log(`\n📁 Written to: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
