// FR-RIDE-041 — port for the driver declaration (licence, insurance, no profit).

/** The consent record of the declaration the member accepted. */
export interface DriverDeclaration {
  readonly userId: string;
  /** Version of the declaration text in force when it was accepted. */
  readonly version: number;
  readonly declaredAt: string;
}

export interface IDriverDeclarationRepository {
  /** The caller's acceptance of the declaration in force, or NULL if not yet accepted. */
  getMine(): Promise<DriverDeclaration | null>;

  /** Records the caller's acceptance of the declaration in force. Idempotent on already-accepted. */
  accept(): Promise<DriverDeclaration>;
}
