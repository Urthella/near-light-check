// How the producer set changes from one epoch to the next, from lists already checked against
// their hashes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { type Head, type Source, follow } from "../src/follow.ts";
import type { LightClientBlock, Producer } from "../src/rpc.ts";
import { moves } from "../src/report.ts";
import { changes } from "../src/verify.ts";

const p = (account_id: string, stake: number): Producer => ({ account_id, public_key: "ed25519:11111111111111111111111111111111", stake: String(stake) });

test("who joins, who leaves, and how the stake of those staying moves", () => {
  const c = changes([p("a.near", 10), p("b.near", 20), p("c.near", 30)], [p("b.near", 25), p("c.near", 30), p("d.near", 5)]);
  assert.deepEqual(c.joined, ["d.near"]);
  assert.deepEqual(c.left, ["a.near"]);
  assert.deepEqual([c.staying, c.stakeBefore, c.stakeAfter], [2, "50", "55"]);
  const same = changes([p("a.near", 1)], [p("a.near", 1)]);
  assert.deepEqual([same.joined, same.left, same.stakeBefore, same.stakeAfter], [[], [], "1", "1"]);
});

test("each step with next producers reports the change to them", async () => {
  const saved: { start: Head; next: Record<string, LightClientBlock | null>; producers: Record<string, Producer[]> } = JSON.parse(gunzipSync(readFileSync(new URL("fixtures/mainnet.json.gz", import.meta.url))).toString());
  const source: Source = { next: async (hash) => saved.next[hash] ?? null, producers: async (hash) => saved.producers[hash] };
  const steps = await follow(source, saved.start);
  const withNext = steps.filter((s) => s.changes);
  assert.ok(withNext.length, "the fixture's blocks name their next producers");
  for (const s of withNext) {
    const c = s.changes!;
    assert.equal(c.staying + c.joined.length, 100, "every next producer either stays or joins");
    assert.ok(!c.joined.some((a) => c.left.includes(a)));
  }
});

test("the change reads as who joins and leaves, and how much more or less the stayers hold", () => {
  assert.equal(moves(changes([p("a.near", 10), p("b.near", 20), p("c.near", 30)], [p("b.near", 25), p("c.near", 30), p("d.near", 5)])), "1 join (d.near), 1 leave (a.near); the 2 staying hold 10.00% more stake");
  assert.equal(moves(changes([p("a.near", 100)], [p("a.near", 99)])), "none join, none leave; the 1 staying hold 1.00% less stake");
  assert.equal(moves(changes([p("a.near", 1)], [p("a.near", 1)])), "none join, none leave; the 1 staying hold the same stake");
  const many = Array.from({ length: 7 }, (_, i) => p(`n${i}.near`, 1));
  assert.match(moves(changes([p("a.near", 1)], [p("a.near", 1), ...many])), /^7 join \(n0\.near, n1\.near, n2\.near, n3\.near, n4\.near and 2 more\)/);
});
