#!/usr/bin/env node
// Generates the argument shapes of every served port method from the port
// interfaces themselves (ADR-010), so the gateway can refuse a malformed call
// before any adapter code sees it.
//
// Source of truth: `PortCatalog` in @kc/infrastructure-api (wire name -> port
// interface). For each method the TypeScript checker gives the resolved type
// of every parameter (mapped and conditional types already evaluated), and
// this script writes it down in a small shape language the gateway validates
// at run time (src/platform/ports/argShapes.ts).
//
//   node scripts/generate-port-args.mjs           writes src/platform/ports/portArgShapes.generated.json
//   node scripts/generate-port-args.mjs --check   exits 1 when the file on disk is stale
//
// Anything the shape language cannot say with certainty becomes "unknown"
// (accept anything): a wrong refusal would break the app, a missed check only
// leaves that argument as unvalidated as it was before.

/* global console, process -- Node globals; the workspace ESLint config declares them for src/ only. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, '../../../packages');
const catalogFile = join(packages, 'infrastructure-api/src/wire/portCatalog.ts');
const outputFile = join(here, '../src/platform/ports/portArgShapes.generated.json');

/** Nesting beyond this is not described; recursive types end here too. */
const MAX_DEPTH = 6;
/** A named type is written once and referenced when its printed name is this short. */
const MAX_REF_NAME = 60;

const program = ts.createProgram([catalogFile], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  baseUrl: packages,
  paths: { '@kc/domain': ['domain/src/index.ts'], '@kc/application': ['application/src/index.ts'] },
});
const checker = program.getTypeChecker();

/** Named object shapes, written once: printed type name -> shape. */
const types = {};
const refOfType = new Map();

function unionShape(members, depth) {
  const shapes = [];
  const seen = new Set();
  for (const member of members) {
    const shape = shapeOf(member, depth);
    if (shape === 'unknown') return 'unknown';
    const key = JSON.stringify(shape);
    if (!seen.has(key)) {
      seen.add(key);
      shapes.push(shape);
    }
  }
  // `boolean` is the union `true | false` to the checker.
  const literalBooleans = shapes.filter((s) => typeof s === 'object' && typeof s.literal === 'boolean');
  const rest = literalBooleans.length === 2 ? [...shapes.filter((s) => !literalBooleans.includes(s)), 'boolean'] : shapes;
  return rest.length === 1 ? rest[0] : { union: rest };
}

function objectShape(type, depth) {
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
  const properties = checker.getPropertiesOfType(type);
  if (index && properties.length === 0) return { record: shapeOf(index.type, depth + 1) };

  const object = {};
  const optional = [];
  for (const property of properties) {
    const propertyType = checker.getTypeOfSymbol(property);
    // A method on a value means it is not plain data; nothing sensible can be checked.
    if (propertyType.getCallSignatures().length > 0) return 'unknown';
    object[property.name] = shapeOf(propertyType, depth + 1);
    if (property.flags & ts.SymbolFlags.Optional) optional.push(property.name);
  }
  return optional.length > 0 ? { object, optional } : { object };
}

function shapeOf(type, depth = 0) {
  if (depth > MAX_DEPTH) return 'unknown';
  const flags = type.flags;
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter | ts.TypeFlags.BigIntLike)) return 'unknown';
  if (flags & ts.TypeFlags.StringLiteral) return { literal: type.value };
  if (flags & ts.TypeFlags.NumberLiteral) return { literal: type.value };
  if (flags & ts.TypeFlags.BooleanLiteral) return { literal: type.intrinsicName === 'true' };
  if (flags & ts.TypeFlags.String) return 'string';
  if (flags & ts.TypeFlags.Number) return 'number';
  if (flags & ts.TypeFlags.Boolean) return 'boolean';
  if (flags & ts.TypeFlags.Null) return 'null';
  if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return 'undefined';
  if (flags & ts.TypeFlags.TemplateLiteral) return 'string';
  if (type.isUnion()) return unionShape(type.types, depth);
  if (!(flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) return 'unknown';

  if (type.getCallSignatures().length > 0) return 'unknown';
  if (checker.isArrayType(type)) return { array: shapeOf(checker.getTypeArguments(type)[0], depth + 1) };
  if (checker.isTupleType(type)) return { tuple: checker.getTypeArguments(type).map((member) => shapeOf(member, depth + 1)) };
  const symbolName = type.symbol?.name;
  // Not JSON: a Date arrives as a string, a Map / Set / Promise not at all.
  if (['Date', 'Map', 'Set', 'Promise', 'RegExp', 'Uint8Array', 'ArrayBuffer', 'Blob', 'File'].includes(symbolName)) return 'unknown';
  if (symbolName === 'ReadonlyArray') return { array: shapeOf(checker.getTypeArguments(type)[0], depth + 1) };

  // A named type is written once and referenced; that also ends recursion.
  const name = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const nameable = (type.aliasSymbol || type.symbol?.declarations?.some((d) => ts.isInterfaceDeclaration(d))) && name.length <= MAX_REF_NAME && !name.startsWith('{');
  if (!nameable) return objectShape(type, depth);
  const existing = refOfType.get(type);
  if (existing) return { ref: existing };
  let ref = name;
  for (let suffix = 2; ref in types; suffix += 1) ref = `${name}#${suffix}`;
  refOfType.set(type, ref);
  types[ref] = 'unknown'; // placeholder while the type is being described (recursion)
  types[ref] = objectShape(type, depth);
  return { ref };
}

/** True when `type` contains a `Date` anywhere (unwrapping promises, lists, unions and object fields). */
function containsDate(type, depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH || seen.has(type)) return false;
  seen.add(type);
  if (type.symbol?.name === 'Date') return true;
  if (type.isUnion() || type.isIntersection()) return type.types.some((member) => containsDate(member, depth, seen));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  const typeArguments = checker.getTypeArguments(type);
  if (typeArguments.some((member) => containsDate(member, depth + 1, seen))) return true;
  if (type.getCallSignatures().length > 0) return false;
  return checker.getPropertiesOfType(type).some((property) => containsDate(checker.getTypeOfSymbol(property), depth + 1, seen));
}

function parameterShape(parameter, declaration) {
  const node = parameter.valueDeclaration;
  const type = checker.getTypeOfSymbolAtLocation(parameter, declaration);
  const rest = Boolean(node && ts.isParameter(node) && node.dotDotDotToken);
  const optional = Boolean(node && ts.isParameter(node) && (node.questionToken || node.initializer)) || rest;
  const shape = rest && checker.isArrayType(type) ? shapeOf(checker.getTypeArguments(type)[0]) : shapeOf(type);
  return { name: parameter.name, shape, ...(optional ? { optional: true } : {}), ...(rest ? { rest: true } : {}) };
}

function generate() {
  const source = program.getSourceFile(catalogFile);
  const catalog = source.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'PortCatalog');
  if (!catalog) throw new Error('PortCatalog interface not found');

  const ports = {};
  /** `<port>.<method>` of every method whose arguments or result hold a Date: only these pay for date handling. */
  const typedMethods = [];
  for (const member of catalog.members) {
    const portName = member.name.getText(source);
    const portType = checker.getTypeAtLocation(member.type);
    const methods = {};
    for (const property of checker.getPropertiesOfType(portType)) {
      const signatures = checker.getTypeOfSymbolAtLocation(property, member).getCallSignatures();
      // An overloaded method has no single parameter list to check against.
      if (signatures.length !== 1) continue;
      const signature = signatures[0];
      methods[property.name] = signature.getParameters().map((parameter) => parameterShape(parameter, member));
      const values = [signature.getReturnType(), ...signature.getParameters().map((parameter) => checker.getTypeOfSymbolAtLocation(parameter, member))];
      if (values.some((type) => containsDate(type))) typedMethods.push(`${portName}.${property.name}`);
    }
    ports[portName] = methods;
  }
  const sortedTypes = Object.fromEntries(Object.entries(types).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ ports, types: sortedTypes, typedMethods: typedMethods.sort() }, null, 1)}\n`;
}

const generated = generate();
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outputFile, 'utf8');
  } catch {
    // Missing file: reported as stale below.
  }
  if (current !== generated) {
    console.error('portArgShapes.generated.json is stale: run `pnpm --filter @kc/api generate:port-args` and commit the result.');
    process.exit(1);
  }
  console.log('port argument shapes are up to date');
} else {
  writeFileSync(outputFile, generated);
  const parsed = JSON.parse(generated);
  const methodCount = Object.values(parsed.ports).reduce((sum, methods) => sum + Object.keys(methods).length, 0);
  console.log(`wrote ${Object.keys(parsed.ports).length} ports, ${methodCount} methods, ${Object.keys(parsed.types).length} named types (${generated.length} bytes)`);
}
