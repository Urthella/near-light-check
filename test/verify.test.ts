// Follows the saved NEAR mainnet replies from a trusted block, then breaks them one rule at a time.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { decode, encode } from "../src/base58.ts";
import { type Head, type Source, follow } from "../src/follow.ts";
import type { LightClientBlock, Producer } from "../src/rpc.ts";
import { approvals, blockHash } from "../src/verify.ts";

interface Saved {
  start: Head;
  next: Record<string, LightClientBlock | null>;
  producers: Record<string, Producer[]>;
  hashes: string[];
}
const load = (): Saved => JSON.parse(gunzipSync(readFileSync(new URL("fixtures/mainnet.json.gz", import.meta.url))).toString());
// A changed block hashes differently; the node would still give the producers for its height,
// which is the one list saved.
const replay = (s: Saved): Source => ({ next: async (hash) => s.next[hash] ?? null, producers: async (hash) => s.producers[hash] ?? Object.values(s.producers)[0] });
const blocks = (s: Saved) => Object.values(s.next).filter((b): b is LightClientBlock => !!b);

test("base58 round-trips, leading zeros included", () => {
  assert.equal(encode(Buffer.from("hello world")), "StV1DL6CwTryKyV");
  assert.equal(decode("StV1DL6CwTryKyV").toString(), "hello world");
  assert.equal(decode("11").toString("hex"), "0000");
  assert.equal(encode(Buffer.from("0000ff", "hex")), "115Q");
  assert.throws(() => decode("0OIl"), /not base58/);
});

test("each light client block rebuilds to the hash the node knows it by", () => {
  const saved = load();
  assert.deepEqual(blocks(saved).map(blockHash), saved.hashes);
});

test("follows from the trusted block to the newest, every block approved by more than 2/3 of the stake", async () => {
  const saved = load();
  const steps = await follow(replay(saved), saved.start);
  assert.equal(steps.length, saved.hashes.length);
  assert.ok(steps.length >= 2, "the fixture crosses an epoch");
  for (const s of steps) {
    assert.deepEqual(s.problems, [], String(s.height));
    assert.ok(BigInt(s.stake) * 3n > BigInt(s.total) * 2n);
  }
  // The first block is in the start's next epoch: its producers come from the node, checked
  // against the start's next_bp_hash. After that, from the block before's next_bps.
  assert.equal(steps[0].epoch_id, saved.start.next_epoch_id);
  assert.deepEqual(steps.map((s) => s.producersFrom), ["next_bp_hash", ...steps.slice(1).map(() => "next_bps")]);
});

/** Follows the saved replies with the first light client block changed by `change`. */
async function broken(change: (block: LightClientBlock, saved: Saved) => void) {
  const saved = load();
  change(saved.next[saved.start.hash]!, saved);
  const steps = await follow(replay(saved), saved.start);
  return { steps, problems: steps.at(-1)!.problems.join("\n") };
}

test("an approval that doesn't verify fails, and following stops there", async () => {
  const { steps, problems } = await broken((b) => {
    const i = b.approvals_after_next.findIndex((a) => a);
    const sig = decode(b.approvals_after_next[i]!.split(":")[1]);
    sig[5] ^= 1;
    b.approvals_after_next[i] = `ed25519:${encode(sig)}`;
  });
  assert.equal(steps.length, 1);
  assert.match(problems, /the approval from [\w.-]+ doesn't verify/);
});

test("approvals carrying 2/3 of the stake or less fail", async () => {
  const { problems } = await broken((b, saved) => {
    const producers = saved.producers[blockHash(b)];
    const total = producers.reduce((sum, p) => sum + BigInt(p.stake), 0n);
    let signed = producers.reduce((sum, p, i) => sum + (b.approvals_after_next[i] ? BigInt(p.stake) : 0n), 0n);
    for (let i = 0; signed * 3n > total * 2n; i++) {
      if (!b.approvals_after_next[i]) continue;
      signed -= BigInt(producers[i].stake);
      b.approvals_after_next[i] = null;
    }
  });
  assert.match(problems, /approvals carry \d+ of \d+ stake, not more than 2\/3/);
});

test("producers that don't hash to the committed next_bp_hash fail", async () => {
  const { problems } = await broken((b, saved) => {
    const producers = saved.producers[blockHash(b)];
    producers[3].stake = String(BigInt(producers[3].stake) + 1n);
  });
  assert.match(problems, /the producers the node gives for its epoch don't hash to the next_bp_hash block \d+ committed to/);
});

test("next producers that don't hash to the block's next_bp_hash fail", async () => {
  const { problems } = await broken((b) => {
    b.next_bps![0].account_id = "someone-else.near";
  });
  assert.match(problems, /its next producers don't hash to its next_bp_hash/);
});

test("a changed header field changes the hash, so no approval verifies", async () => {
  const { problems } = await broken((b) => {
    b.inner_lite.outcome_root = encode(Buffer.alloc(32, 7));
  });
  assert.match(problems, /doesn't verify/);
});

test("a block from an unrelated epoch, or a new epoch without its next producers, fails", async () => {
  const other = await broken((b) => {
    b.inner_lite.epoch_id = encode(Buffer.alloc(32, 9));
  });
  assert.match(other.problems, /its epoch \w+ is neither block \d+'s nor the one after/);
  const bare = await broken((b) => {
    b.next_bps = null;
  });
  assert.match(bare.problems, /it's in a new epoch but doesn't name the next epoch's producers/);
});

test("a block no newer than the head ends the walk", async () => {
  const saved = load();
  saved.next[saved.start.hash]!.inner_lite.height = saved.start.height;
  assert.deepEqual(await follow(replay(saved), saved.start), []);
});

test("exactly 2/3 of the stake isn't enough, and approvals beyond the producers fail", () => {
  const saved = load();
  const block = saved.next[saved.start.hash]!;
  const producers = structuredClone(saved.producers[blockHash(block)]);
  const signer = block.approvals_after_next.findIndex((a) => a);
  const absent = block.approvals_after_next.findIndex((a) => !a);
  assert.ok(absent >= 0, "some producer didn't approve");
  // The one signer holds 2, a producer who didn't approve holds 1, everyone else 0: 2 of 3.
  producers.forEach((p, i) => (p.stake = i === signer ? "2" : i === absent ? "1" : "0"));
  const exact = approvals(block, producers);
  assert.deepEqual([exact.stake, exact.total], [2n, 3n]);
  assert.match(exact.problems.join(), /approvals carry 2 of 3 stake, not more than 2\/3/);
  const extra = structuredClone(block);
  extra.approvals_after_next.push(null);
  assert.match(approvals(extra, saved.producers[blockHash(block)]).problems.join(), /101 approvals for 100 producers/);
});

test("the walk stops at the newest final block, not at every block after it", async () => {
  const saved = load();
  const steps = await follow(replay(saved), saved.start);
  const last = saved.next[steps.at(-2)!.hash]!;
  // A node that would go on answering with newer blocks in the same epoch.
  saved.next[steps.at(-1)!.hash] = { ...structuredClone(last), inner_lite: { ...last.inner_lite, height: last.inner_lite.height + 1 } };
  assert.equal((await follow(replay(saved), saved.start)).length, steps.length);
});

test("each step that passes, with the next producers known, reports the change to them", async () => {
  const saved = load();
  const steps = await follow(replay(saved), saved.start);
  const withNext = steps.filter((s) => s.changes);
  assert.equal(withNext.length, steps.length, "the fixture's blocks all name their next producers");
  for (const { changes: c } of withNext) {
    assert.equal(c!.staying + c!.joined.length, 100, "every next producer either stays or joins");
    assert.ok(!c!.joined.some((a) => c!.left.includes(a)));
  }
});

test("a step that fails carries no change: a list it gave proves nothing", async () => {
  const { steps } = await broken((b) => {
    b.approvals_after_next = b.approvals_after_next.map(() => null);
  });
  assert.ok(steps.at(-1)!.problems.length);
  assert.equal(steps.at(-1)!.changes, undefined);
});
