// The row an RPC that must return one answered with.
//
// PostgREST types a function that returns a table row as nullable. The world RPCs always return
// the changed row on success, so a null answer is an unexpected failure, never an empty success.

/** `row`, or an error naming the RPC when the answer was empty. */
export function requireRpcRow<T>(row: T | null | undefined, rpcName: string): T {
  if (row === null || row === undefined) throw new Error(`${rpcName} returned no row`);
  return row;
}
