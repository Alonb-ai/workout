/**
 * Hand-rolled Web Push for Cloudflare Workers.
 *
 * Implements:
 *   - RFC 8292 VAPID signing (ECDSA P-256 / ES256 JWT)
 *   - RFC 8291 message encryption (ECDH P-256 + HKDF + AES-128-GCM)
 *   - RFC 8188 aes128gcm content encoding
 *
 * No npm dependencies — pure WebCrypto so it runs in any Workers/Edge runtime.
 */

// ----- Base64URL helpers -----

export function b64urlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ----- VAPID -----

/** Import a base64url-encoded raw P-256 private key (32-byte d) for signing. */
async function importVapidPrivateKey(b64urlPrivate: string, b64urlPublic: string): Promise<CryptoKey> {
  // Reconstruct a JWK from the raw private + public parts.
  const d = b64urlPrivate;
  const pub = b64urlDecode(b64urlPublic);
  // raw public is 0x04 || X (32) || Y (32) for uncompressed P-256
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be 65-byte uncompressed P-256');
  }
  const x = b64urlEncode(pub.slice(1, 33));
  const y = b64urlEncode(pub.slice(33, 65));
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d, x, y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export async function generateVapidJwt(
  audience: string,
  privateKeyB64: string,
  publicKeyB64: string,
  subject: string,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  };
  const enc = new TextEncoder();
  const headerB64 = b64urlEncode(enc.encode(JSON.stringify(header)));
  const claimsB64 = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;
  const key = await importVapidPrivateKey(privateKeyB64, publicKeyB64);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(signingInput),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

// ----- HKDF helpers -----

/**
 * Cast a Uint8Array to BufferSource. Needed because lib.dom in newer TS
 * tightened BufferSource so it no longer accepts Uint8Array<ArrayBufferLike>
 * automatically — we know all our buffers are ArrayBuffer-backed.
 */
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function hkdfImport(ikm: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(ikm), { name: 'HKDF' }, false, ['deriveBits']);
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await hkdfImport(ikm);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ----- aes128gcm encryption per RFC 8291 -----

function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const RS = 4096; // record size

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function encryptPayload(
  payload: Uint8Array,
  recipientP256dhB64: string,
  recipientAuthB64: string,
): Promise<Uint8Array> {
  const recipientPub = b64urlDecode(recipientP256dhB64);
  const authSecret = b64urlDecode(recipientAuthB64);

  // Generate ephemeral ECDH keypair.
  const local = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;

  const recipientKey = await crypto.subtle.importKey(
    'raw',
    buf(recipientPub),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );

  // Shared secret (ECDH).
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey },
    local.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedBits);

  // Export local public key raw (65 bytes uncompressed).
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));

  // Random salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 §3.4:
  // PRK_key = HKDF(auth_secret, ecdh_secret, "WebPush: info" || ua_public || as_public, 32)
  const enc = new TextEncoder();
  const keyInfo = concat(
    enc.encode('WebPush: info\0'),
    recipientPub,
    localPubRaw,
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cekRaw = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  // NONCE = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const cek = await crypto.subtle.importKey('raw', buf(cekRaw), { name: 'AES-GCM' }, false, ['encrypt']);

  // Payload + 0x02 padding delimiter (single-record case).
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(nonce) },
    cek,
    buf(plaintext),
  );
  const ciphertext = new Uint8Array(ciphertextBuf);

  // aes128gcm header: salt(16) || rs(4 BE) || idlen(1) || keyid(idlen) || ciphertext
  // For Web Push, keyid is the local public key (65 bytes).
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RS, false);
  const idlen = new Uint8Array([localPubRaw.length]);

  return concat(salt, rs, idlen, localPubRaw, ciphertext);
}

// ----- High-level send -----

export interface SendPushOptions {
  subscription: PushSubscriptionJSON;
  payload: string | Uint8Array;
  vapidPublicKey: string; // base64url
  vapidPrivateKey: string; // base64url
  vapidSubject: string; // mailto:...
  ttl?: number; // seconds, default 60
}

export interface SendPushResult {
  ok: boolean;
  status: number;
  body?: string;
  /** True if the endpoint is gone (404/410) — caller should drop the subscription. */
  gone: boolean;
}

export async function sendWebPush(opts: SendPushOptions): Promise<SendPushResult> {
  const endpoint = new URL(opts.subscription.endpoint);
  const audience = `${endpoint.protocol}//${endpoint.host}`;
  const jwt = await generateVapidJwt(
    audience,
    opts.vapidPrivateKey,
    opts.vapidPublicKey,
    opts.vapidSubject,
  );

  const payloadBytes =
    typeof opts.payload === 'string' ? new TextEncoder().encode(opts.payload) : opts.payload;
  const body = await encryptPayload(
    payloadBytes,
    opts.subscription.keys.p256dh,
    opts.subscription.keys.auth,
  );

  const res = await fetch(opts.subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(opts.ttl ?? 60),
      Authorization: `vapid t=${jwt}, k=${opts.vapidPublicKey}`,
    },
    body: body as unknown as BodyInit,
  });

  const gone = res.status === 404 || res.status === 410;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, body: text, gone };
  }
  return { ok: true, status: res.status, gone: false };
}
