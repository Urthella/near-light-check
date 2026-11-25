# near-light-check

Follows NEAR mainnet from a block you trust to the newest final one, the way its light client
protocol does, from any public RPC node, with no SDK. For each light client block on the way,
`near-light-check`:

1. **rebuilds the block's hash** from its parts, in borsh, as NEAR hashes it;
2. **verifies its block producers' ed25519 approvals**, and checks they carry more than 2/3 of the
   producers' stake;
3. **checks each epoch's producers** against the hash the block before committed to, so only the
   start is taken on trust;
4. **shows how the producers change** into the next epoch: who joins, who leaves, and how the
   stake of those staying moves.

It exits 1 if a block fails a check.

## Why

A light client doesn't download the chain. It needs only one block an epoch, about every 12
hours: the last one of each, signed by the producers of the epoch, and naming the producers of
the next. NEAR's wallets and bridges, like the Rainbow Bridge to Ethereum, follow the chain this
way.

The protocol is in NEAR's specification, the Nomicon. `near-light-check` follows it with nothing
but Node's SHA-256 and ed25519:

- **On 2026-11-25,** from a block two epochs back, three light client blocks reached the newest. In
  each, 80 to 91 of the 100 producers had approved, holding 84.73% to 96.96% of their stake.
- **Approvals are for the block after:** a producer signs an endorsement of the next block's hash
  at the height two above. The light client block carries that next block's inner hash so the
  signature can be checked.
- **The 100 seats barely move:** no producer joined or left across the epochs walked, and the
  stake of those staying grew 0.03% an epoch.

## Quick start

Needs Node 24 or later, and nothing else.

```sh
git clone https://github.com/Urthella/near-light-check && cd near-light-check
node src/main.ts
```

```text
from block 226,059,268, 2qsn6t5AYDTk8TJtxNocKV9FFFZ2DAYjG3BswcKd5EAz (trusted): 3 light client blocks to block 226,145,674
  block 226,122,734, epoch CcaTMZPY: 91 of 100 producers approved, 96.96% of their stake; producers the node's, checked against the block before's next_bp_hash
    next epoch: none join, none leave; the 100 staying hold 0.03% more stake
  block 226,145,673, epoch C6xhYyeQ: 80 of 100 producers approved, 84.73% of their stake; producers from the block before's next producers
    next epoch: none join, none leave; the 100 staying hold 0.03% more stake
  block 226,145,674, epoch C6xhYyeQ: 85 of 100 producers approved, 89.65% of their stake; producers from the block before's next producers
  newest: EBkFpa4xexkYieXuQzD3G1sQMEjMyjNJ2Lt6kjAWZxnE
  check: 3 of 3 blocks hash, link and carry more than 2/3 of their producers' stake
```

- `--epochs N` starts from the block N epochs back, 43,200 blocks each: 2 by default. The default
  node keeps about two and a half epochs; an archival node goes further.
- `--from HASH` starts from a block you trust instead, by its hash.
- `--rpc URL` picks the node: `https://rpc.mainnet.fastnear.com` by default, or
  `https://rpc.mainnet.near.org`.
- `--json` prints the start and each step as JSON.

Exit codes: 0 when every block passes, 1 when one fails a check, and 2 when it couldn't check: a
node without that much history, or bad arguments.

## What it does

- **Asks for the next light client block** after the head, with `next_light_client_block`: the
  last final block of an epoch, or the newest final block once in the current one.
- **The block hash** is `sha256(sha256(sha256(inner_lite) ++ inner_rest_hash) ++ prev_block_hash)`.
  `inner_lite` is borsh: the height and timestamp as little-endian u64s, and six 32-byte hashes.
  Each hash rebuilt is the one the next request goes by, so a wrong hash finds no block.
- **The approvals** sign borsh `ApprovalInner::Endorsement(next_block_hash)` followed by the height
  plus two, where `next_block_hash = sha256(next_block_inner_hash ++ block_hash)`. Approval *i*
  belongs to producer *i*; each must verify, and together they must carry more than 2/3 of the
  producers' stake.
- **The producers of each epoch** come from the block before:
  - from its `next_bps`, once they hash to its `next_bp_hash`;
  - or, for the first block in a new epoch, the node's list from
    `EXPERIMENTAL_validators_ordered`, checked against the head's `next_bp_hash`.
  - Producers are a borsh list of `ValidatorStake::V1`: account, ed25519 key and u128 stake.
- **Checks the epochs line up**, as the Nomicon's `validate_and_update_head` does:
  - each block is in the head's epoch or the next;
  - a block in the next epoch must name the producers of the one after;
  - it stops at the first block that fails, since nothing after it can be trusted.
- **Compares each epoch's producers with the next's**, both lists already checked: accounts that
  join or leave, and the stake of those in both. Blocks in the same epoch name the same next
  producers, so the change is shown once per epoch.

## How it's checked

- **The building blocks:**
  - base58 against known strings, leading zeros included;
  - the change between two producer lists, and how it reads, on lists worked out by hand.
- **Real blocks:** every reply the light client needed, from a block two epochs back to the
  newest, recorded by [`scripts/fetch-fixtures.ts`](scripts/fetch-fixtures.ts).
  - Each light client block rebuilds to the hash the node knows it by, and following them passes
    every check.
  - Then they're broken one rule at a time: an approval, approvals at 2/3 of the stake or less,
    more approvals than producers, producers or next producers that don't hash to what was
    committed, a header field, an unrelated epoch, a new epoch without its next producers. Each
    fails, and following stops there.
- **End to end:** the CLI runs against a fake node replaying those replies:
  - it follows from two epochs back, steps past a skipped height, and starts from `--from`;
  - each epoch's change of producers is shown once;
  - an approval that doesn't verify exits 1;
  - a rate-limited node is asked again;
  - missing history, bad arguments and an unreachable node exit 2.
- **Mutation testing:** thirty-one deliberate bugs were planted one at a time, and the tests
  caught every one.
- **Live**, on 2026-11-25: from FastNEAR's and NEAR's public nodes, every block passed.

## Limits

- **The start is the root of trust,** along with its own epoch's producers when the first block is
  still in that epoch. Start from a hash you got from a source you trust.
- **ed25519 producers only,** as NEAR's are.
- **Consensus, not state.** Proving an account or a transaction against these blocks takes NEAR's
  `light_client_proof`, which this doesn't do.

## License

MIT
