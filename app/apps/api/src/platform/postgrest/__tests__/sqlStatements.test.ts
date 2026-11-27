import { describe, expect, it } from 'vitest';
import { PostgrestCompatError } from '../compatError';
import { type CompatRequest, planRequest } from '../requestPlan';
import { buildStatement, MAX_ROWS, resolveSignature } from '../sqlStatements';
import { BASE, TEST_CACHE } from './support';

/** Plans and builds in one step, the way the engine does. */
function sql(method: string, path: string, extra: Partial<CompatRequest> = {}) {
  return buildStatement(planRequest({ method, url: `${BASE}${path}`, headers: {}, body: null, ...extra }), TEST_CACHE);
}

const REPRESENTATION = { headers: { prefer: 'return=representation' } };

describe('buildStatement: reads', () => {
  it('binds every filter value and never writes one into the SQL text', () => {
    const statement = sql('GET', "/books?select=id,title&title=eq.it's; drop table books&id=in.(1,2)&note=ilike.*x*");

    expect(statement.values).toEqual(["it's; drop table books", ['1', '2'], '%x%']);
    expect(statement.text).not.toContain('drop table');
    expect(statement.text).toContain('"public"."books"."title" = $1');
    expect(statement.text).toContain('"public"."books"."id" = any($2)');
    expect(statement.text).toContain('"public"."books"."note" ilike $3');
  });

  it('builds logic trees, negation, is, ordering and paging', () => {
    const statement = sql('GET', '/books?or=(a.gt.1,and(b.is.null,c.neq.2))&d=not.lte.3&order=a.desc.nullsfirst,b&limit=5&offset=10');

    expect(statement.text).toContain('(("public"."books"."a" > $1) or (("public"."books"."b" is null) and ("public"."books"."c" <> $2)))');
    expect(statement.text).toContain('not ("public"."books"."d" <= $3)');
    expect(statement.text).toContain('order by "public"."books"."a" desc nulls first, "public"."books"."b" asc limit 5 offset 10');
  });

  it('caps the page size at the row limit of the Supabase stack', () => {
    expect(sql('GET', '/books').text).toContain(`limit ${MAX_ROWS}`);
    expect(sql('GET', '/books?limit=999999').text).toContain(`limit ${MAX_ROWS}`);
  });

  it('counts matching rows with the same filters when asked', () => {
    const statement = sql('GET', '/books?author_id=eq.7', { headers: { prefer: 'count=exact' } });

    expect(statement.text).toContain('(select count(*) from "public"."books" where ("public"."books"."author_id" = $1))::text as total');
    expect(statement.values).toEqual(['7']);
  });

  it('embeds a parent as an object and children as an array', () => {
    const toParent = sql('GET', '/books?select=id,authors(name)').text;
    const toChildren = sql('GET', '/authors?select=id,books(title)').text;

    expect(toParent).toContain('(select row_to_json(_embedded) from (select "public"."authors"."name" as "name" from "public"."authors"');
    expect(toParent).toContain('where "public"."authors"."id" = "public"."books"."author_id" limit 1');
    expect(toChildren).toContain("coalesce((select json_agg(_embedded) from (select \"public\".\"books\".\"title\" as \"title\"");
    expect(toChildren).toContain('"public"."books"."author_id" = "public"."authors"."id"');
  });

  it('embeds a one-to-one child as an object and filters the parent on an inner join', () => {
    const statement = sql('GET', '/authors?select=id,profiles!inner(bio)').text;

    expect(statement).toContain('select row_to_json(_embedded)');
    expect(statement).toContain('where exists (select 1 from "public"."profiles" where "public"."profiles"."author_id" = "public"."authors"."id")');
  });

  it.each([
    ['no relationship', '/books?select=id,profiles(bio)', 'PGRST200'],
    ['a relation embedded in itself', '/books?select=id,books(id)', 'PGRST100'],
    ['a column that is not an identifier', '/books?select=id&bad%22name=eq.1', 'PGRST100'],
  ])('rejects %s', (_case, path, code) => {
    expect(() => sql('GET', path)).toThrowError(expect.objectContaining({ code }));
  });
});

describe('buildStatement: changes', () => {
  it('inserts through the table type, so Postgres converts every value', () => {
    const statement = sql('POST', '/books?select=id', { ...REPRESENTATION, body: '{"title":"a","author_id":"7"}' });

    expect(statement.text).toContain(
      'insert into "public"."books" ("title", "author_id") select "title", "author_id" from json_populate_recordset(null::"public"."books", $1::json)',
    );
    expect(statement.text).toContain('returning "public"."books".*');
    expect(statement.values).toEqual(['[{"title":"a","author_id":"7"}]']);
  });

  it('merges or ignores on conflict', () => {
    const merge = sql('POST', '/books?on_conflict=isbn', { headers: { prefer: 'resolution=merge-duplicates' }, body: '{"isbn":"1","title":"a"}' });
    const ignore = sql('POST', '/books?on_conflict=isbn', { headers: { prefer: 'resolution=ignore-duplicates' }, body: '{"isbn":"1"}' });

    expect(merge.text).toContain('on conflict ("isbn") do update set "isbn" = excluded."isbn", "title" = excluded."title"');
    expect(ignore.text).toContain('on conflict ("isbn") do nothing');
    expect(merge.text).not.toContain('returning');
  });

  it('inserts a row of defaults for an empty body', () => {
    expect(sql('POST', '/books', { body: '{}' }).text).toContain('insert into "public"."books" default values');
  });

  it('updates only the patched columns of the filtered rows', () => {
    const statement = sql('PATCH', '/books?id=eq.1', { ...REPRESENTATION, body: '{"title":"b"}' });

    expect(statement.text).toContain('update "public"."books" set "title" = _patch."title" from (select * from json_populate_record(null::"public"."books", $1::json)) as _patch');
    expect(statement.text).toContain('where ("public"."books"."id" = $2) returning "public"."books".*');
    expect(statement.values).toEqual(['{"title":"b"}', '1']);
  });

  it('deletes the filtered rows', () => {
    expect(sql('DELETE', '/books?id=eq.1').text).toContain('delete from "public"."books" where ("public"."books"."id" = $1)');
  });

  it.each([
    ['an update of the whole table', 'PATCH', '/books', '{"title":"b"}', '21000'],
    ['a delete of the whole table', 'DELETE', '/books', null, '21000'],
    ['an update with no column', 'PATCH', '/books?id=eq.1', '{}', 'PGRST100'],
  ])('refuses %s', (_case, method, path, body, code) => {
    expect(() => sql(method, path, { body })).toThrowError(expect.objectContaining({ code }));
  });
});

describe('buildStatement: functions', () => {
  it('passes arguments as one JSON value converted to the declared types', () => {
    const statement = sql('POST', '/rpc/book_count', { body: '{"p_author":"7"}' });

    expect(statement.text).toBe(
      'with _args as (select * from json_to_record($1::json) as _typed("p_author" uuid)) ' +
        'select to_json("public"."book_count"("p_author" => (select "p_author" from _args)))::text as body, 1 as row_count',
    );
    expect(statement.values).toEqual(['{"p_author":"7"}']);
  });

  it('calls a function without arguments, and one that returns nothing', () => {
    expect(sql('POST', '/rpc/ping').text).toBe('select null::text as body, 0 as row_count from (select "public"."ping"()) as _call');
  });

  it('returns a set of values as an array', () => {
    expect(sql('POST', '/rpc/tags_of', { body: '{"p_book":"1"}' }).text).toContain("coalesce(json_agg(_value), '[]')::text as body");
  });

  it('returns one composite as an object and a set of them as an array', () => {
    const one = sql('POST', '/rpc/publish_book', { body: '{"p_book":"1"}' }).text;
    const many = sql('POST', '/rpc/search_books?order=title&limit=3', { body: '{"p_query":"x"}' }).text;

    expect(one).toContain('_result as materialized (select * from "public"."publish_book"');
    expect(one).toContain('(json_agg(_rows) -> 0)::text as body');
    expect(many).toContain("coalesce(json_agg(_rows), '[]')::text as body");
    expect(many).toContain('order by _result."title" asc limit 3');
  });

  it('omits arguments that have a default and were not sent', () => {
    const statement = sql('POST', '/rpc/search_books', { body: '{"p_query":"x"}' });

    expect(statement.text).toContain('as _typed("p_query" text)');
    expect(statement.text).not.toContain('p_limit');
  });

  it.each([
    ['an unknown function', 'nope', [], 'PGRST202'],
    ['an unknown argument', 'book_count', ['p_author', 'p_extra'], 'PGRST202'],
    ['a missing required argument', 'book_count', [], 'PGRST202'],
    ['overloads that differ only by type', 'overloaded', ['p_a'], 'PGRST203'],
  ])('refuses %s', (_case, name, provided, code) => {
    expect(() => resolveSignature(name, provided, TEST_CACHE)).toThrowError(expect.objectContaining({ code }));
    expect(() => resolveSignature(name, provided, TEST_CACHE)).toThrow(PostgrestCompatError);
  });
});
