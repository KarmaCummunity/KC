import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseSession, IdentityDatabase } from '../database/identityDatabase';
import type { CallerIdentity } from '../identity/callerIdentity';

/** What `storage.buckets` says about a bucket. */
export interface BucketRules {
  /** Its files are readable by anyone who has the address. */
  readonly isPublic: boolean;
  /** Largest file it takes, in bytes; null: no limit of its own. */
  readonly fileSizeLimit: number | null;
  /** The content types it takes; null: any. */
  readonly allowedMimeTypes: readonly string[] | null;
}

/** Longest object name the API looks at. */
export const MAX_OBJECT_NAME_LENGTH = 512;
/** PostgreSQL insufficient_privilege: what a refused write under row-level security raises. */
const INSUFFICIENT_PRIVILEGE = '42501';
/** PostgreSQL foreign_key_violation: the bucket does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';
/** PostgreSQL unique_violation: a file of that name is already in the index. */
const UNIQUE_VIOLATION = '23505';
/** True when the text holds a C0 control character or DEL: characters with no place in a path. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * True for a name the store can hold as it is: a relative path of plain
 * segments. A name that climbs (`..`), starts at the root or carries control
 * characters is refused before any policy is asked, so no policy has to
 * foresee it.
 */
export function isSafeObjectName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_OBJECT_NAME_LENGTH || hasControlCharacter(name)) return false;
  return name.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Decides who may write, read or delete a stored file, with the policies
 * already written on `storage.objects` (ADR-012 section 3): the caller may
 * upload a file when they could insert its row, read a private file when they
 * could select the row, and delete it when they could delete the row. Every
 * check runs in a transaction that is rolled back, so asking leaves no trace
 * and a bucket no policy opens is closed to everyone.
 */
@Injectable()
export class StorageAuthorizer {
  constructor(@Inject(IdentityDatabase) private readonly database: IdentityDatabase) {}

  /** The bucket's own rules, or null when there is no such bucket. */
  async bucketRules(bucket: string): Promise<BucketRules | null> {
    const row = await this.database.runAsService(
      async (session) => (await session.query<{ public: boolean | null; file_size_limit: string | null; allowed_mime_types: string[] | null }>('select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket])).rows[0],
    );
    if (!row) return null;
    return { isPublic: row.public === true, fileSizeLimit: row.file_size_limit === null ? null : Number(row.file_size_limit), allowedMimeTypes: row.allowed_mime_types };
  }

  /**
   * True when the policies let the caller insert the row of `<bucket>/<name>`.
   * Whether a file of that name already exists is a separate question
   * (`objectExists`): the policy is checked before the unique index, so a
   * duplicate means the policy allowed the row.
   */
  mayUpload(caller: CallerIdentity, bucket: string, name: string): Promise<boolean> {
    if (!isSafeObjectName(name)) return Promise.resolve(false);
    return this.database.inspectAsService(async (session) => {
      await actAs(session, caller);
      try {
        await session.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
        return true;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === UNIQUE_VIOLATION) return true;
        if (code !== INSUFFICIENT_PRIVILEGE && code !== FOREIGN_KEY_VIOLATION) throw error;
        return false;
      }
    });
  }

  /** True when the index has a file of that name, whoever it belongs to. */
  objectExists(bucket: string, name: string): Promise<boolean> {
    return this.database.inspectAsService(async (session) => (await session.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount === 1);
  }

  /**
   * True when the caller may be given the file: anyone for a public bucket,
   * and for a private one a member who could select the object's row.
   * @param caller The signed-in member, or null for a visitor.
   */
  async mayRead(caller: CallerIdentity | null, bucket: string, name: string): Promise<boolean> {
    if (!isSafeObjectName(name)) return false;
    const rules = await this.bucketRules(bucket);
    if (!rules) return false;
    if (rules.isPublic) return true;
    if (!caller) return false;
    return this.database.inspectAsService(async (session) => {
      const id = await rowOf(session, bucket, name);
      await actAs(session, caller);
      return (await session.query('select 1 from storage.objects where id = $1', [id])).rowCount === 1;
    });
  }

  /** True when the caller could delete the row of `<bucket>/<name>`. */
  mayDelete(caller: CallerIdentity, bucket: string, name: string): Promise<boolean> {
    if (!isSafeObjectName(name)) return Promise.resolve(false);
    return this.database.inspectAsService(async (session) => {
      const id = await rowOf(session, bucket, name).catch((error: { code?: string }) => {
        if (error.code === FOREIGN_KEY_VIOLATION) return null;
        throw error;
      });
      if (id === null) return false;
      await actAs(session, caller);
      return (await session.query('delete from storage.objects where id = $1', [id])).rowCount === 1;
    });
  }
}

/** Switches the rest of the transaction to the caller, as every request of theirs runs. */
async function actAs(session: DatabaseSession, caller: CallerIdentity): Promise<void> {
  await session.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [JSON.stringify(caller.claims)]);
}

/**
 * The id of the object's row: the real one when the file exists, otherwise a
 * probe written as the service role (row-level security does not bind it), so
 * a policy can be asked about a file whether or not it is there yet.
 */
async function rowOf(session: DatabaseSession, bucket: string, name: string): Promise<string> {
  const existing = await session.query<{ id: string }>('select id from storage.objects where bucket_id = $1 and name = $2 limit 1', [bucket, name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const probe = await session.query<{ id: string }>('insert into storage.objects (bucket_id, name) values ($1, $2) returning id', [bucket, name]);
  return (probe.rows[0] as { id: string }).id;
}
