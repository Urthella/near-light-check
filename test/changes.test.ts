// How the producer set changes from one epoch to the next, and how that reads.

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeChanges } from "../src/report.ts";
import type { Producer } from "../src/rpc.ts";
import { changes } from "../src/verify.ts";

const p = (account_id: string, stake: number): Producer => ({ account_id, public_key: "ed25519:11111111111111111111111111111111", stake: String(stake) });
const read = (current: Producer[], next: Producer[]) => {
  const c = changes(current, next);
  return describeChanges({ ...c, stakeBefore: String(c.stakeBefore), stakeAfter: String(c.stakeAfter) });
};

test("who joins, who leaves, and how the stake of those staying moves", () => {
  const c = changes([p("a.near", 10), p("b.near", 20), p("c.near", 30)], [p("b.near", 25), p("c.near", 30), p("d.near", 5)]);
  assert.deepEqual(c.joined, ["d.near"]);
  assert.deepEqual(c.left, ["a.near"]);
  assert.deepEqual([c.staying, c.stakeBefore, c.stakeAfter], [2, 50n, 55n]);
  const same = changes([p("a.near", 1)], [p("a.near", 1)]);
  assert.deepEqual([same.joined, same.left, same.stakeBefore, same.stakeAfter], [[], [], 1n, 1n]);
});

test("the change reads as who joins and leaves, and how much more or less the stayers hold", () => {
  assert.equal(read([p("a.near", 10), p("b.near", 20), p("c.near", 30)], [p("b.near", 25), p("c.near", 30), p("d.near", 5)]), "1 join (d.near), 1 leave (a.near); the 2 staying hold 10.00% more stake");
  assert.equal(read([p("a.near", 100)], [p("a.near", 99)]), "none join, none leave; the 1 staying hold 1.00% less stake");
  assert.equal(read([p("a.near", 1)], [p("a.near", 1)]), "none join, none leave; the 1 staying hold the same stake");
  const many = Array.from({ length: 7 }, (_, i) => p(`n${i}.near`, 1));
  assert.match(read([p("a.near", 1)], [p("a.near", 1), ...many]), /^7 join \(n0\.near, n1\.near, n2\.near, n3\.near, n4\.near and 2 more\)/);
});

test("a whole new set, or a change too small for two places, still reads right", () => {
  assert.equal(read([p("a.near", 5)], [p("b.near", 5)]), "1 join (b.near), 1 leave (a.near); none stay", "no stake to compare: no division by zero");
  assert.equal(read([p("a.near", 1_000_000)], [p("a.near", 1_000_001)]), "none join, none leave; the 1 staying hold under 0.01% more stake");
  assert.equal(read([p("a.near", 1_000_000)], [p("a.near", 999_000)]), "none join, none leave; the 1 staying hold 0.10% less stake");
});
