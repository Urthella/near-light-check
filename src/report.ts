// The text report: each step of the walk, how the producers change at each epoch, and the summary.

import type { Head, Step } from "./follow.ts";

const number = (n: number | string) => BigInt(n).toLocaleString("en-US");
/** A share in percent, to six places, from whole numbers. */
const percentOf = (part: bigint, whole: bigint) => Number((part * 100_000_000n) / whole) / 1_000_000;
/** Two places, cut rather than rounded, so 66.669% never reads as more than 2/3. */
const twoPlaces = (x: number) => (Math.trunc(x * 100) / 100).toFixed(2);
const names = (accounts: string[]) => (accounts.length > 5 ? `${accounts.slice(0, 5).join(", ")} and ${accounts.length - 5} more` : accounts.join(", "));

/** One line on how the producers change: who joins and leaves, and the stake of those who stay. */
export function describeChanges(c: NonNullable<Step["changes"]>): string {
  const joined = c.joined.length ? `${c.joined.length} join (${names(c.joined)})` : "none join";
  const left = c.left.length ? `${c.left.length} leave (${names(c.left)})` : "none leave";
  if (!c.staying) return `${joined}, ${left}; none stay`;
  const [before, after] = [BigInt(c.stakeBefore), BigInt(c.stakeAfter)];
  const change = Math.abs(percentOf(after - before, before));
  const direction = after > before ? "more" : "less";
  const stake = after === before ? "the same stake" : change < 0.005 ? `under 0.01% ${direction} stake` : `${change.toFixed(2)}% ${direction} stake`;
  return `${joined}, ${left}; the ${c.staying} staying hold ${stake}`;
}

const FROM = { next_bps: "from the block before's next producers", next_bp_hash: "the node's, checked against the block before's next_bp_hash", start: "the node's, trusted along with the start" };

export function describe(head: Head, steps: Step[]): string {
  const lines = [`from block ${number(head.height)}, ${head.hash} (trusted): ${steps.length} light client blocks${steps.length ? ` to block ${number(steps.at(-1)!.height)}` : ", already the newest"}`];
  steps.forEach((s, i) => {
    lines.push(`  block ${number(s.height)}, epoch ${s.epoch_id.slice(0, 8)}: ${s.signed} of ${s.of} producers approved, ${twoPlaces(percentOf(BigInt(s.stake), BigInt(s.total)))}% of their stake; producers ${FROM[s.producersFrom]}`);
    // Blocks in the same epoch name the same next producers: say how they change once.
    if (s.changes && s.epoch_id !== steps[i - 1]?.epoch_id) lines.push(`    next epoch: ${describeChanges(s.changes)}`);
    for (const p of s.problems) lines.push(`    ${p}`);
  });
  if (steps.length) lines.push(`  newest: ${steps.at(-1)!.hash}`);
  const good = steps.filter((s) => !s.problems.length).length;
  lines.push(`  check: ${good} of ${steps.length} blocks hash, link and carry more than 2/3 of their producers' stake`);
  return lines.join("\n");
}
