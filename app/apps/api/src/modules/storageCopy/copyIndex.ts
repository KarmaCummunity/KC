import type { IdentityDatabase } from '../../platform/database/identityDatabase';
import type { CopyIndex, IndexedFile } from './copyStoredFiles';

/** The type a file is served with when its row records none. */
const UNTYPED = 'application/octet-stream';

interface IndexRow {
  name: string;
  size: string | null;
  content_type: string | null;
  cache_control: string | null;
  etag: string | null;
}

/**
 * The checksum an entity tag stands for, when it is one. The source stores
 * the MD5 of a file sent in one piece as its tag, in quotes; a file sent in
 * parts gets a tag of another form, which says nothing about its bytes.
 * @returns The MD5 in lower-case hex, or null for a tag that is not a plain MD5.
 */
export function md5OfEntityTag(tag: string | null): string | null {
  const value = (tag ?? '').replace(/^"|"$/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(value) ? value : null;
}

/**
 * The index of KC's files (`storage.objects`), read as the service role in
 * byte order of the names, which is the order both stores list in.
 */
export function createCopyIndex(database: Pick<IdentityDatabase, 'runAsService'>): CopyIndex {
  return {
    page: (bucket, after, limit) =>
      database.runAsService(async (session) => {
        const { rows } = await session.query<IndexRow>(
          `select name,
                  case when metadata->>'size' ~ '^[0-9]+$' then metadata->>'size' end as size,
                  metadata->>'mimetype' as content_type,
                  metadata->>'cacheControl' as cache_control,
                  metadata->>'eTag' as etag
             from storage.objects
            where bucket_id = $1 and name is not null and ($2::text is null or name collate "C" > $2)
            order by name collate "C"
            limit $3`,
          [bucket, after, limit],
        );
        return rows.map(
          (row): IndexedFile => ({
            name: row.name,
            size: row.size === null ? null : Number(row.size),
            contentType: row.content_type ?? UNTYPED,
            cacheControl: row.cache_control,
            md5: md5OfEntityTag(row.etag),
          }),
        );
      }),
  };
}
