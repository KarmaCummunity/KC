// FR-POST-023 — `/post/:id`: link-preview card, store redirect or the SPA. See web-edge/src.
import { handleSharedLink } from '../../web-edge/src/handleSharedLink.mjs';

export function onRequestGet({ request, env, params, next }) {
  return handleSharedLink({ kind: 'post', param: String(params.id), request, env, next });
}
