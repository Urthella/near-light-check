// Runs the real CLI against a fake NEAR node replaying the saved replies, which can be told to
// misbehave.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import type { Head } from "../src/follow.ts";
import type { LightClientBlock, Producer } from "../src/rpc.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const saved: { start: Head; next: Record<string, LightClientBlock | null>; producers: Record<string, Producer[]>; hashes: string[] } = JSON.parse(gunzipSync(readFileSync(new URL("fixtures/mainnet.json.gz", import.meta.url))).toString());
const { start } = saved;

/** How far above two epochs past the start the tip is: the start's height is found by stepping down. */
let skipped = 0;
let rateLimits = 0;
let badApproval = false;

const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const { id, method, params } = JSON.parse(body);
  const reply = (status: number, payload: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
  if (rateLimits > 0) {
    rateLimits--;
    return reply(429, {});
  }
  const ok = (result: unknown) => reply(200, { jsonrpc: "2.0", id, result });
  const unknown = () => reply(200, { jsonrpc: "2.0", id, error: { code: -32000, message: "Server error", cause: { name: "UNKNOWN_BLOCK" } } });
  if (method === "block") {
    if (params.finality === "final") return ok({ header: { ...start, height: start.height + 2 * 43_200 + skipped } });
    return params.block_id === start.height || params.block_id === start.hash ? ok({ header: start }) : unknown();
  }
  if (method === "next_light_client_block") {
    const block = structuredClone(saved.next[params.last_block_hash] ?? {}) as LightClientBlock;
    if (badApproval && params.last_block_hash === start.hash) {
      const i = block.approvals_after_next.findIndex((a) => a);
      block.approvals_after_next[i] = block.approvals_after_next[block.approvals_after_next.findLastIndex((a) => a)];
    }
    return ok(block);
  }
  if (method === "EXPERIMENTAL_validators_ordered") return saved.producers[params.block_id] ? ok(saved.producers[params.block_id]) : unknown();
  reply(200, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
server.unref();
const RPC = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [MAIN, "--rpc", RPC, ...args], (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }));
  });
}

const n = saved.hashes.length;

test("follows from two epochs back to the newest block, exit 0", async () => {
  const { code, stdout, stderr } = await run();
  assert.equal(code, 0, stderr);
  assert.match(stdout, new RegExp(`^from block ${start.height.toLocaleString("en-US")}, ${start.hash} \\(trusted\\): ${n} light client blocks to block [\\d,]+\n`));
  assert.match(stdout, /\n  block [\d,]+, epoch \w{8}: \d+ of 100 producers approved, \d+\.\d\d% of their stake; producers the node's, checked against the block before's next_bp_hash\n/);
  assert.match(stdout, /; producers from the block before's next producers\n/);
  assert.match(stdout, new RegExp(`\n  newest: ${saved.hashes.at(-1)}\n`));
  assert.match(stdout, new RegExp(`\n  check: ${n} of ${n} blocks hash, link and carry more than 2/3 of their producers' stake$`, "m"));
  // One line on the next producers for each epoch walked through, however many of its blocks.
  const epochs = new Set([...stdout.matchAll(/epoch (\w{8}):/g)].map((m) => m[1]));
  assert.equal([...stdout.matchAll(/\n    next epoch: \w+ joins?.*, \w+ leaves?.*; the \d+ staying hold .* stake\n/g)].length, epochs.size);
});

test("a skipped height is stepped past to the block below", async () => {
  skipped = 3;
  try {
    const { code, stderr } = await run();
    assert.equal(code, 0, stderr);
  } finally {
    skipped = 0;
  }
});

test("--from starts from a trusted hash, and --json prints the steps", async () => {
  // Two epochs back from this tip is out of the node's reach: only --from finds the start.
  skipped = 50;
  const { code, stdout } = await run("--from", start.hash, "--json").finally(() => (skipped = 0));
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.start.hash, start.hash);
  assert.deepEqual(report.steps.map((s: { hash: string }) => s.hash), saved.hashes);
});

test("an approval that doesn't verify exits 1 and says whose", async () => {
  badApproval = true;
  try {
    const { code, stdout } = await run();
    assert.equal(code, 1, stdout);
    assert.match(stdout, /\n    the approval from [\w.-]+ doesn't verify\n/);
    assert.match(stdout, /check: 0 of 1 blocks hash, link/);
  } finally {
    badApproval = false;
  }
});

test("a node that rate-limits is asked again", async () => {
  rateLimits = 2;
  const { code, stderr } = await run();
  assert.equal(code, 0, stderr);
  assert.equal(rateLimits, 0);
});

test("history the node doesn't keep, bad arguments and an unreachable node exit 2", async () => {
  skipped = 50;
  try {
    const old = await run();
    assert.equal(old.code, 2);
    assert.match(old.stderr, /no block in the 10 heights below \d+: the node may not keep that much history/);
  } finally {
    skipped = 0;
  }
  for (const args of [["--epochs", "0"], ["--epochs", "101"], ["--epochs", "two"], ["--from", "0xabc"], ["--to", "1"]]) {
    const bad = await run(...args);
    assert.equal(bad.code, 2, `${args}: ${bad.stderr}`);
    assert.match(bad.stderr, /usage: near-light-check/);
  }
  const closed = await new Promise<number>((resolve) => execFile(process.execPath, [MAIN, "--rpc", "http://127.0.0.1:1"], (error) => resolve(error ? Number(error.code) : 0)));
  assert.equal(closed, 2);
});
