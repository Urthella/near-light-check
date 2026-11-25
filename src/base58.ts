// Base58, Bitcoin's alphabet, which NEAR uses for hashes, keys and signatures.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decode(text: string): Buffer {
  let n = 0n;
  for (const c of text) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw new Error(`not base58: ${text}`);
    n = n * 58n + BigInt(digit);
  }
  const hex = n.toString(16);
  const body = n ? Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex") : Buffer.alloc(0);
  // Each leading "1" is a leading zero byte.
  const zeros = text.length - text.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

export function encode(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  const zeros = bytes.length - Buffer.from(bytes).toString("hex").replace(/^(00)+/, "").length / 2;
  return "1".repeat(zeros) + out;
}

/** A NEAR key or signature, "ed25519:<base58>", as its raw bytes. */
export function ed25519(text: string): Buffer {
  const [type, value] = text.split(":");
  if (type !== "ed25519" || !value) throw new Error(`not an ed25519 key or signature: ${text}`);
  return decode(value);
}
