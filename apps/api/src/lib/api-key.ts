const KEY_PREFIX = "mk_live_";
const SECRET_BYTES = 24;

export type GeneratedApiKey = {
  /** Shown to the user only once; only its hash is persisted. */
  plaintext: string;
  /** First few characters, safe to store in plaintext for display in the UI (e.g. "mk_live_a1b2c3d4"). */
  prefix: string;
  hash: string;
};

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export async function hashApiKey(plaintext: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(plaintext);
  return hasher.digest("hex");
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const secret = toHex(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
  const plaintext = `${KEY_PREFIX}${secret}`;
  const hash = await hashApiKey(plaintext);
  const prefix = plaintext.slice(0, KEY_PREFIX.length + 8);

  return { plaintext, prefix, hash };
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}
