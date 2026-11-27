/** A statement and its bound values, ready for the driver. */
export interface SqlStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * Collects bound values while SQL text is assembled, handing back the `$n`
 * placeholder for each. Keeps every value out of the SQL text.
 */
export class SqlParameters {
  private readonly bound: unknown[] = [];

  /** Binds `value` and returns its placeholder. */
  add(value: unknown): string {
    this.bound.push(value);
    return `$${this.bound.length}`;
  }

  get values(): readonly unknown[] {
    return this.bound;
  }
}
