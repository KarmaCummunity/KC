import type { PortDefinition } from '../../platform/ports/portDefinition';
import { ADMIN_PORTS } from './ports/admin';
import { CONVERSATIONS_PORTS } from './ports/conversations';
import { ORGANIZATIONS_PORTS } from './ports/organizations';
import { PEOPLE_PORTS } from './ports/people';
import { POSTS_PORTS } from './ports/posts';
import { RIDES_PORTS } from './ports/rides';

/**
 * Every port the API serves by running its existing Supabase data adapter on
 * the server (ADR-010). A port leaves these files when a native module
 * replaces its adapter.
 *
 * Rules the declarations in `ports/` follow:
 * - **Wire name**: the port interface without its `I` prefix and its
 *   `Repository` / `Service` suffix, first letter lower case
 *   (`IRideBookingRepository` → `rideBooking`).
 * - **`public`** only where the database itself lets a signed-out visitor in
 *   (the functions and tables granted to the `anon` role). The gateway never
 *   opens more than the database does; `hostedPorts.kc.integration.test.ts`
 *   checks the two against each other.
 * - **`not_served`** for a method that reaches Storage or an Edge Function;
 *   the app keeps its current adapter for it until phases 7 and 8.
 *
 * Not here on purpose: the realtime ports (phase 6), the auth service
 * (phase 9), the Edge Function services (phase 8) and the legal documents
 * port, whose adapter is a device cache around public reads.
 */
export const HOSTED_PORTS: readonly PortDefinition[] = [
  ...PEOPLE_PORTS,
  ...POSTS_PORTS,
  ...CONVERSATIONS_PORTS,
  ...RIDES_PORTS,
  ...ORGANIZATIONS_PORTS,
  ...ADMIN_PORTS,
];
