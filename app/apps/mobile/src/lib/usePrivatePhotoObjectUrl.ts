// PRIVATE WEB transport prototype. Not wired into the product. Native consumes ImageSource headers.
// Keeps bearer off image URLs and drops/revokes blob URLs when access/source changes or unmounts.
import { useEffect, useMemo, useState } from 'react';
import type { PrivatePhotoSource } from './privatePhotoSource';
import { privatePhotoBlob } from './privatePhotoBlob';

type Loaded = { readonly identity: object; readonly uri: string };
export function usePrivatePhotoObjectUrl(descriptor: PrivatePhotoSource | null): string | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const identity = descriptor?.recyclingKey ?? null;
  const uri = descriptor?.source.uri;
  const bearer = descriptor?.source.headers.Authorization;
  // Opaque request identity changes with credentials without putting the bearer in a cache key.
  const requestIdentity = useMemo(() => identity && uri && bearer ? {} : null, [identity, uri, bearer]);
  useEffect(() => {
    if (!requestIdentity || !uri || !bearer) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => { active = false; controller.abort(); }, 15_000);
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(uri, { headers: { Authorization: bearer }, cache: 'no-store',
          redirect: 'error', credentials: 'omit', signal: controller.signal });
        const blob = await privatePhotoBlob(response);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ identity: requestIdentity, uri: objectUrl });
      } catch {
        // Fail closed. No public, original, previous-principal or headerless fallback.
      } finally { clearTimeout(timeout); }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestIdentity, uri, bearer]);
  // Same render removes a revoked/recycled image before any asynchronous cleanup runs.
  return requestIdentity && loaded?.identity === requestIdentity ? loaded.uri : null;
}
