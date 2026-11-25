// Saves what the tests follow: a NEAR mainnet block from two epochs back, and every reply the
// light client needs from there to the newest final block, recorded as it follows them, with the
// node's own hash for each light client block. Run: node scripts/fetch-fixtures.ts

import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { type Source, follow } from "../src/follow.ts";
import { type LightClientBlock, type Producer, Rpc } from "../src/rpc.ts";

const rpc = new Rpc("https://rpc.mainnet.fastnear.com");
const tip = await rpc.header({ finality: "final" });
const start = await rpc.header({ block_id: tip.height - 2 * 43_200 });
const next: Record<string, LightClientBlock | null> = {};
const producers: Record<string, Producer[]> = {};
const recorder: Source = {
  next: async (hash) => (next[hash] = await rpc.next(hash)),
  producers: async (hash) => (producers[hash] = await rpc.producers(hash)),
};
const steps = await follow(recorder, start);
const hashes = [];
for (const s of steps) hashes.push((await rpc.header({ block_id: s.height })).hash);
writeFileSync(new URL("../test/fixtures/mainnet.json.gz", import.meta.url), gzipSync(JSON.stringify({ start, next, producers, hashes }), { level: 9 }));
console.log(`from block ${start.height}: ${steps.length} light client blocks, ${steps.filter((s) => s.problems.length).length} failing`);
