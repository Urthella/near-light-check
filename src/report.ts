// The text report: each step of the walk, how the producers change at each epoch, and the summary.

import type { Head, Step } from "./follow.ts";
import type { Changes } from "./verify.ts";

const number = (n: number | string) => BigInt(n).toLocaleString("en-US");
const percent = (part: string, whole: string) => (Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100).toFixed(2);
const names = (accounts: string[]) => (accounts.length > 5 ? `${accounts.slice(0, 5).join(", ")} and ${accounts.length - 5} more` : accounts.join(", "));

/** One line on how the producers change: who joins and leaves, and the stake of those who stay. */
export function moves(c: Changes): string {
  const joined = c.joined.length ? `${c.joined.length} join (${names(c.joined)})` : "none join";
  const left = c.left.length ? `${c.left.length} leave (${names(c.left)})` : "none leave";
  const change = Number(((BigInt(c.stakeAfter) - BigInt(c.stakeBefore)) * 1_000_000n) / BigInt(c.stakeBefore)) / 10_000;
  const stake = change ? `${Math.abs(change).toFixed(2)}% ${change > 0 ? "more" : "less"} stake` : "the same stake";
  return `${joined}, ${left}; the ${c.staying} staying hold ${stake}`;
}

const FROM = { next_bps: "from the block before's next producers", next_bp_hash: "the node's, checked against the block before's next_bp_hash", start: "the node's, trusted along with the start" };

export function describe(head: Head, steps: Step[]): string {
  const lines = [`from block ${number(head.height)}, ${head.hash} (trusted): ${steps.length} light client blocks${steps.length ? ` to block ${number(steps.at(-1)!.height)}` : ", already the newest"}`];
  steps.forEach((s, i) => {
    lines.push(`  block ${number(s.height)}, epoch ${s.epoch_id.slice(0, 8)}: ${s.signed} of ${s.of} producers approved, ${percent(s.stake, s.total)}% of their stake; producers ${FROM[s.producersFrom]}`);
    // Blocks in the same epoch name the same next producers: say how they change once.
    if (s.changes && s.epoch_id !== steps[i - 1]?.epoch_id) lines.push(`    next epoch: ${moves(s.changes)}`);
    for (const p of s.problems) lines.push(`    ${p}`);
  });
  if (steps.length) lines.push(`  newest: ${steps.at(-1)!.hash}`);
  const good = steps.filter((s) => !s.problems.length).length;
  lines.push(`  check: ${good} of ${steps.length} blocks hash, link and carry more than 2/3 of their producers' stake`);
  return lines.join("\n");
}
