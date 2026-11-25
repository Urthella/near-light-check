#!/usr/bin/env node
// near-light-check: follows NEAR mainnet from a trusted block to the newest final one, the way its
// light client protocol does: each light client block's hash rebuilt, its producers' ed25519
// approvals checked against more than 2/3 of their stake, and each epoch's producers against the
// hash the epoch before committed to. Exits 1 if a block fails, 2 if it couldn't check.

import { parseArgs } from "node:util";

import { type Head, follow } from "./follow.ts";
import { describe } from "./report.ts";
import { Rpc } from "./rpc.ts";

const USAGE = "usage: near-light-check [--rpc URL] [--epochs N | --from HASH] [--json]";
const EPOCH_LENGTH = 43_200;
/** Heights can be skipped: how far below one to look for a block. */
const SKIPPED = 10;

async function start(rpc: Rpc, epochs: number, from?: string): Promise<Head> {
  if (from) return rpc.header({ block_id: from });
  const tip = await rpc.header({ finality: "final" });
  for (let h = tip.height - epochs * EPOCH_LENGTH; h > tip.height - epochs * EPOCH_LENGTH - SKIPPED; h--) {
    try {
      return await rpc.header({ block_id: h });
    } catch (error) {
      if (!/UNKNOWN_BLOCK/.test((error as Error).message)) throw error;
    }
  }
  throw new Error(`no block in the ${SKIPPED} heights below ${tip.height - epochs * EPOCH_LENGTH}: the node may not keep that much history`);
}

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        rpc: { type: "string", default: "https://rpc.mainnet.fastnear.com" },
        epochs: { type: "string", default: "2" },
        from: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.error(USAGE);
    return 0;
  }
  const epochs = Number(values.epochs);
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 100) {
    console.error(`--epochs must be 1 to 100: ${values.epochs}\n${USAGE}`);
    return 2;
  }
  if (values.from !== undefined && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(values.from)) {
    console.error(`--from must be a block hash in base58: ${values.from}\n${USAGE}`);
    return 2;
  }
  try {
    const rpc = new Rpc(values.rpc);
    const head = await start(rpc, epochs, values.from);
    const steps = await follow(rpc, head);
    console.log(values.json ? JSON.stringify({ start: head, steps }, null, 2) : describe(head, steps));
    // Not process.exit(): it can trip a libuv assertion on Windows.
    return steps.some((s) => s.problems.length) ? 1 : 0;
  } catch (error) {
    console.error(`near-light-check: ${(error as Error).message}`);
    return 2;
  }
}

process.exitCode = await main();
