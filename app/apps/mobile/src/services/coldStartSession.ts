// FR-AUTH-013 — cold-start session restore, extracted from AuthGate.
// The auth subscription can deliver a live session (INITIAL_SESSION, a token
// refresh) before `restore` settles. A late restore failure (e.g. a 401 while
// refreshing) used to call setSession(null) and overwrite it, flashing the
// sign-in screen for a frame (TD-127 item 2). While restoring, a live non-null
// session wins and live nulls are deferred; afterwards every change applies.

type Deps<S> = {
  restore: () => Promise<S | null>;
  subscribe: (listener: (session: S | null) => void) => () => void;
  /** Dev-only auto sign-in; returns a session to use instead, or null. */
  devFallback: (restored: S | null) => Promise<S | null>;
  setSession: (session: S | null) => void;
};

export function startColdStartSession<S>({ restore, subscribe, devFallback, setSession }: Deps<S>): () => void {
  let active = true;
  let restoring = true;
  let live: S | null = null;

  const unsubscribe = subscribe((session) => {
    if (!active) return;
    if (!restoring) return setSession(session);
    live = session;
    if (session) setSession(session);
  });

  void (async () => {
    let restored: S | null = null;
    try {
      restored = await restore();
    } catch {
      /* treated as signed out unless the subscription delivered a session */
    }
    const fallback = await devFallback(restored);
    if (!active) return;
    restoring = false;
    setSession(live ?? fallback ?? restored);
  })();

  return () => {
    active = false;
    unsubscribe();
  };
}
