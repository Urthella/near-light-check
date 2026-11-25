// Follows NEAR from a trusted block to the newest final one, a light client block at a time, as
// the Nomicon's validate_and_update_head does. Each block's producers come from the block before:
// its next_bps once checked against its next_bp_hash, or the node's list checked against that hash.

import type { LightClientBlock, Producer } from "./rpc.ts";
import { approvals, blockHash, producersHash } from "./verify.ts";

/** Where light client blocks and producer lists come from: the RPC node, or saved replies. */
export interface Source {
  next(hash: string): Promise<LightClientBlock | null>;
  producers(hash: string): Promise<Producer[]>;
}

/** The trusted block a light client starts from. */
export interface Head {
  hash: string;
  height: number;
  epoch_id: string;
  next_epoch_id: string;
  next_bp_hash: string;
}

export interface Step {
  height: number;
  hash: string;
  epoch_id: string;
  /**
   * Where its producers came from: the block before's next_bps; the node's list, checked against
   * the block before's next_bp_hash; or the node's list for the start's own epoch, which is trusted
   * along with the start.
   */
  producersFrom: "next_bps" | "next_bp_hash" | "start";
  signed: number;
  of: number;
  stake: string;
  total: string;
  problems: string[];
}

export async function follow(source: Source, start: Head, limit = 50): Promise<Step[]> {
  const steps: Step[] = [];
  const known = new Map<string, Producer[]>();
  let head = start;
  while (steps.length < limit) {
    const block = await source.next(head.hash);
    if (!block || block.inner_lite.height <= head.height) break;
    const l = block.inner_lite;
    const hash = blockHash(block);
    const problems: string[] = [];
    if (l.epoch_id !== head.epoch_id && l.epoch_id !== head.next_epoch_id) problems.push(`its epoch ${l.epoch_id} is neither block ${head.height}'s nor the one after`);
    if (l.epoch_id === head.next_epoch_id && !block.next_bps) problems.push("it's in a new epoch but doesn't name the next epoch's producers");
    let producers = known.get(l.epoch_id);
    let producersFrom: Step["producersFrom"] = "next_bps";
    if (!producers) {
      producers = await source.producers(hash);
      producersFrom = l.epoch_id === head.next_epoch_id ? "next_bp_hash" : "start";
      if (producersFrom === "next_bp_hash" && producersHash(producers) !== head.next_bp_hash) problems.push(`the producers the node gives for its epoch don't hash to the next_bp_hash block ${head.height} committed to`);
    }
    const signed = approvals(block, producers);
    problems.push(...signed.problems);
    if (block.next_bps) {
      if (producersHash(block.next_bps) !== l.next_bp_hash) problems.push("its next producers don't hash to its next_bp_hash");
      else known.set(l.next_epoch_id, block.next_bps);
    }
    steps.push({ height: l.height, hash, epoch_id: l.epoch_id, producersFrom, signed: signed.signed, of: signed.of, stake: String(signed.stake), total: String(signed.total), problems });
    // Nothing after a block that fails can be trusted. A block in the head's own epoch is the
    // newest final one: after it the node only has blocks that finalize one by one.
    if (problems.length || l.epoch_id === head.epoch_id) break;
    head = { hash, height: l.height, epoch_id: l.epoch_id, next_epoch_id: l.next_epoch_id, next_bp_hash: l.next_bp_hash };
  }
  return steps;
}
