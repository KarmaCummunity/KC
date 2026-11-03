// Client-side JSON Schema checks aligned with public.listing_kinds.detail_schema.

type SchemaProp = {
  type?: string | string[];
  enum?: unknown[];
  items?: { type?: string };
  const?: unknown;
  format?: string;
};

function propTypes(prop: SchemaProp): string[] {
  if (Array.isArray(prop.type)) return prop.type;
  return prop.type ? [prop.type] : ['string'];
}

function matchesType(value: unknown, types: string[]): boolean {
  return types.some((t) => TYPE_CHECKS[t]?.(value) ?? false);
}

function isIsoDateTime(s: string): boolean {
  return !Number.isNaN(Date.parse(s));
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  null: (v) => v === null,
  boolean: (v) => typeof v === 'boolean',
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  number: (v) => typeof v === 'number',
  string: (v) => typeof v === 'string',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

function isBlank(val: unknown): boolean {
  return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
}

/** Returns the error code prefix for a single present value, or null when valid. */
function checkProp(prop: SchemaProp, val: unknown): string | null {
  if (prop.const !== undefined && val !== prop.const) return 'const';
  if (!matchesType(val, propTypes(prop))) return 'type';
  if (prop.enum && !prop.enum.includes(val)) return 'enum';
  if (prop.format === 'date-time' && typeof val === 'string' && !isIsoDateTime(val)) return 'format';
  if (prop.items?.type === 'string' && Array.isArray(val) && !val.every((x) => typeof x === 'string')) {
    return 'array';
  }
  return null;
}

export function validateListingDetails(
  schema: Record<string, unknown>,
  details: Record<string, unknown>,
): string | null {
  const props = (schema.properties ?? {}) as Record<string, SchemaProp>;
  const required = (schema.required ?? []) as string[];

  const missing = required.find((key) => isBlank(details[key]));
  if (missing !== undefined) return `required:${missing}`;

  for (const [key, val] of Object.entries(details)) {
    const prop = props[key];
    if (!prop) {
      if (schema.additionalProperties === false) return `extra:${key}`;
      continue;
    }
    if (val === undefined || val === null) continue;
    const code = checkProp(prop, val);
    if (code) return `${code}:${key}`;
  }

  return null;
}
