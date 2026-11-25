// NEAR's light client protocol, as its specification (the Nomicon) gives it: rebuild a light
// client block's hash from its parts, check its producers' approvals, and the next producers'
// hash.

import { createHash, createPublicKey, verify } from "node:crypto";

import { decode, ed25519, encode } from "./base58.ts";
import type { InnerLite, LightClientBlock, Producer } from "./rpc.ts";

const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

const u64 = (n: bigint | number) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  return out;
};

/** BlockHeaderInnerLite in borsh: the fields in order, integers little-endian, hashes as 32 bytes. */
export const innerLite = (l: InnerLite) =>
  Buffer.concat([u64(l.height), decode(l.epoch_id), decode(l.next_epoch_id), decode(l.prev_state_root), decode(l.outcome_root), u64(BigInt(l.timestamp_nanosec)), decode(l.next_bp_hash), decode(l.block_merkle_root)]);

/** A block's hash: sha256(sha256(sha256(inner_lite) ++ inner_rest_hash) ++ prev_block_hash). */
export const blockHashBytes = (b: LightClientBlock) => sha256(sha256(sha256(innerLite(b.inner_lite)), decode(b.inner_rest_hash)), decode(b.prev_block_hash));

export const blockHash = (b: LightClientBlock) => encode(blockHashBytes(b));

const u32 = (n: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(n);
  return out;
};

/** A producer list in borsh: a u32 count, then each as ValidatorStake::V1 { account_id, ed25519 key, u128 stake }. */
function producersBorsh(producers: Producer[]): Buffer {
  const parts: Uint8Array[] = [u32(producers.length)];
  for (const p of producers) {
    const account = Buffer.from(p.account_id);
    const stake = Buffer.alloc(16);
    const s = BigInt(p.stake);
    stake.writeBigUInt64LE(s & ((1n << 64n) - 1n), 0);
    stake.writeBigUInt64LE(s >> 64n, 8);
    parts.push(Buffer.of(0), u32(account.length), account, Buffer.of(0), ed25519(p.public_key), stake);
  }
  return Buffer.concat(parts);
}

/** What next_bp_hash commits to: the sha256 of the next epoch's producers in borsh. */
export const producersHash = (producers: Producer[]) => encode(sha256(producersBorsh(producers)));

/**
 * What block producers sign for a block: an endorsement of the block after it, at the height two
 * above: borsh(ApprovalInner::Endorsement(next_block_hash)) ++ (height + 2) as a little-endian u64.
 */
export function approvalMessage(b: LightClientBlock): Buffer {
  const next = sha256(decode(b.next_block_inner_hash), blockHashBytes(b));
  return Buffer.concat([Buffer.of(0), next, u64(b.inner_lite.height + 2)]);
}

const verifies = (key: Buffer, message: Buffer, signature: Buffer) => verify(null, message, createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.toString("base64url") }, format: "jwk" }), signature);

export interface Approvals {
  signed: number;
  of: number;
  stake: bigint;
  total: bigint;
  problems: string[];
}

/** Approval i belongs to producer i. Each must verify; their stake must be more than 2/3 of all producers'. */
export function approvals(b: LightClientBlock, producers: Producer[]): Approvals {
  const result: Approvals = { signed: 0, of: producers.length, stake: 0n, total: producers.reduce((sum, p) => sum + BigInt(p.stake), 0n), problems: [] };
  if (b.approvals_after_next.length > producers.length) result.problems.push(`${b.approvals_after_next.length} approvals for ${producers.length} producers`);
  const message = approvalMessage(b);
  producers.forEach((p, i) => {
    const signature = b.approvals_after_next[i];
    if (!signature) return;
    if (!verifies(ed25519(p.public_key), message, ed25519(signature))) return void result.problems.push(`the approval from ${p.account_id} doesn't verify`);
    result.signed++;
    result.stake += BigInt(p.stake);
  });
  if (result.stake * 3n <= result.total * 2n) result.problems.push(`approvals carry ${result.stake} of ${result.total} stake, not more than 2/3`);
  return result;
}

export interface Changes {
  joined: string[];
  left: string[];
  /** Producers in both epochs, and their stake in each, in yoctoNEAR. */
  staying: number;
  stakeBefore: string;
  stakeAfter: string;
}

/** How the producer set moves from one epoch's list to the next's. */
export function changes(current: Producer[], next: Producer[]): Changes {
  const before = new Map(current.map((p) => [p.account_id, BigInt(p.stake)]));
  const after = new Map(next.map((p) => [p.account_id, BigInt(p.stake)]));
  const result = { joined: [] as string[], left: [] as string[], staying: 0, before: 0n, after: 0n };
  for (const [account, stake] of after) {
    if (!before.has(account)) result.joined.push(account);
    else {
      result.staying++;
      result.before += before.get(account)!;
      result.after += stake;
    }
  }
  for (const account of before.keys()) if (!after.has(account)) result.left.push(account);
  return { joined: result.joined, left: result.left, staying: result.staying, stakeBefore: String(result.before), stakeAfter: String(result.after) };
}
