// A small client for NEAR's JSON-RPC, with the calls its light client protocol needs.

const ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A block producer, as NEAR's views give it. Keys and hashes are base58. */
export interface Producer {
  account_id: string;
  public_key: string;
  stake: string;
  validator_stake_struct_version?: string;
}

export interface InnerLite {
  height: number;
  epoch_id: string;
  next_epoch_id: string;
  prev_state_root: string;
  outcome_root: string;
  timestamp_nanosec: string;
  next_bp_hash: string;
  block_merkle_root: string;
}

/** What next_light_client_block returns: enough to rebuild the block's hash and check its approvals. */
export interface LightClientBlock {
  prev_block_hash: string;
  next_block_inner_hash: string;
  inner_lite: InnerLite;
  inner_rest_hash: string;
  next_bps: Producer[] | null;
  approvals_after_next: (string | null)[];
}

export interface Header {
  hash: string;
  height: number;
  epoch_id: string;
  next_epoch_id: string;
  next_bp_hash: string;
}

export class Rpc {
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "near-light-check" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
      // Public nodes answer bursts with 429; wait and ask again.
      if ((response.status === 429 || response.status >= 500) && attempt < ATTEMPTS) {
        await response.body?.cancel();
        await sleep(1000 * attempt);
        continue;
      }
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
      const body = (await response.json()) as { result?: T; error?: { message: string; cause?: { name: string } } };
      if (body.error) throw new Error(`${method}: ${body.error.cause?.name ?? body.error.message}`);
      return body.result!;
    }
  }

  header = async (id: { finality: "final" } | { block_id: number | string }) => (await this.call<{ header: Header }>("block", id)).header;
  producers = (blockHash: string) => this.call<Producer[]>("EXPERIMENTAL_validators_ordered", { block_id: blockHash });
  /** The next light client block after `hash`, or null when there's nothing newer (the node sends {}). */
  async next(hash: string): Promise<LightClientBlock | null> {
    const block = await this.call<LightClientBlock | Record<string, never>>("next_light_client_block", { last_block_hash: hash });
    return "inner_lite" in block ? (block as LightClientBlock) : null;
  }
}
