// FR-POST-023 — `/user/:handle`: link-preview card, store redirect or the SPA. See web-edge/src.
import { handleSharedLink } from '../../web-edge/src/handleSharedLink.mjs';

export function onRequestGet({ request, env, params, next }) {
  return handleSharedLink({ kind: 'user', param: String(params.handle), request, env, next });
}
