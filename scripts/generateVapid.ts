/**
 * Generate a VAPID keypair for Web Push.
 * Run with: npx tsx scripts/generateVapid.ts
 *
 * Prints two base64url-encoded strings:
 *   - PUBLIC_KEY  (65 bytes uncompressed P-256, base64url) — paste into both
 *     the Cloudflare Worker secret VAPID_PUBLIC_KEY and the Iron Track settings.
 *   - PRIVATE_KEY (32 bytes, base64url) — paste into the Worker secret
 *     VAPID_PRIVATE_KEY ONLY. Never put this in the frontend or commit it.
 */

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return Buffer.from(bin, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlFromB64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main(): Promise<void> {
  const { webcrypto } = await import('node:crypto');
  // Generate an extractable ECDH P-256 keypair (functionally identical to ECDSA
  // P-256 for VAPID; we export raw + JWK to get both representations we need).
  const pair = (await webcrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;

  const pubRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  if (!jwk.d) throw new Error('private key has no `d` component');

  const publicKey = b64url(pubRaw);
  const privateKey = b64urlFromB64(jwk.d);

  // Machine-readable output for consumption by worker/setup.sh.
  if (process.argv.includes('--machine')) {
    process.stdout.write(`PUBLIC=${publicKey}\nPRIVATE=${privateKey}\n`);
    return;
  }

  console.log('\n=== VAPID keypair ===\n');
  console.log('PUBLIC_KEY  (frontend + Worker secret VAPID_PUBLIC_KEY):');
  console.log(`  ${publicKey}\n`);
  console.log('PRIVATE_KEY (Worker secret VAPID_PRIVATE_KEY ONLY — never expose):');
  console.log(`  ${privateKey}\n`);
  console.log('Next steps:');
  console.log('  cd worker');
  console.log('  npx wrangler secret put VAPID_PUBLIC_KEY    # paste the public key');
  console.log('  npx wrangler secret put VAPID_PRIVATE_KEY   # paste the private key');
  console.log('  npx wrangler secret put VAPID_SUBJECT       # mailto:you@example.com');
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
