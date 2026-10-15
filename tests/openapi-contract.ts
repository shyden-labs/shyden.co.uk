import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * #781. Reads an OpenAPI 3.1 file and checks a real `Response` against it.
 *
 * A subset validator, deliberately: it understands the schema keywords the
 * report API's specs use and refuses any other, so a spec that grows a
 * keyword this file cannot judge fails here instead of passing unread.
 */

export type Schema = Record<string, unknown>;

interface MediaType {
  readonly schema: Schema;
}

interface ResponseObject {
  readonly description?: string;
  readonly headers?: Record<string, { readonly required?: boolean }>;
  readonly content?: Record<string, MediaType>;
  /** Form mode answers this status with no body (the JSON mode carries `content`). */
  readonly 'x-empty-in-form-mode'?: boolean;
}

interface Operation {
  readonly responses?: Record<string, ResponseObject>;
  readonly requestBody?: {
    readonly content: Record<string, MediaType>;
  };
}

export interface OpenApiDoc {
  readonly openapi: string;
  readonly paths: Record<string, Record<string, Operation>>;
  readonly components?: { readonly schemas?: Record<string, Schema> };
}

const KNOWN = new Set([
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'maxLength',
  'minLength',
  'description',
  'format',
  'examples',
  'example',
  '$ref',
]);

export function loadSpec(path: string): OpenApiDoc {
  const doc = parse(readFileSync(path, 'utf8')) as OpenApiDoc;
  if (!/^3\.1\./.test(doc?.openapi ?? ''))
    throw new Error(`${path}: not OpenAPI 3.1`);
  return doc;
}

const resolve = (doc: OpenApiDoc, schema: Schema): Schema => {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  const name = /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
  const target = name ? doc.components?.schemas?.[name] : undefined;
  if (!target) throw new Error(`unresolvable $ref ${ref}`);
  return target;
};

const kindOf = (value: unknown): string =>
  Array.isArray(value)
    ? 'array'
    : value === null
      ? 'null'
      : typeof value === 'number' && Number.isInteger(value)
        ? 'integer'
        : typeof value;

/** How one value disagrees with a schema that holds no other schema. */
function leafFindings(
  doc: OpenApiDoc,
  raw: Schema,
  value: unknown,
  at: string,
): string[] {
  const schema = resolve(doc, raw);
  const unread = Object.keys(schema).filter((key) => !KNOWN.has(key));
  if (unread.length)
    return [
      `${at}: schema keyword(s) this checker cannot read: ${unread.join(', ')}`,
    ];
  const actual = kindOf(value);
  const type = schema.type;
  if (
    type !== undefined &&
    !(type === actual || (type === 'number' && actual === 'integer'))
  )
    return [`${at}: ${actual}, the spec says ${String(type)}`];
  const found: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    found.push(`${at}: ${JSON.stringify(value)} is not in the enum`);
  if ('const' in schema && schema.const !== value)
    found.push(
      `${at}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`,
    );
  return found;
}

/**
 * Every way `value` disagrees with `raw`, each naming where; empty means it
 * agrees. One level deep, which is all the report API's bodies are: a body
 * schema's properties are read as leaves, and a property that holds a schema
 * of its own (`properties` or `items`) is refused, never passed unread.
 */
export function validate(
  doc: OpenApiDoc,
  raw: Schema,
  value: unknown,
  at: string,
): string[] {
  const schema = resolve(doc, raw);
  const found = leafFindings(
    doc,
    Object.fromEntries(
      Object.entries(schema).filter(
        ([key]) =>
          !['properties', 'required', 'additionalProperties'].includes(key),
      ),
    ),
    value,
    at,
  );
  if (found.length || kindOf(value) !== 'object') return found;
  const object = value as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  for (const name of (schema.required ?? []) as string[])
    if (!(name in object)) found.push(`${at}.${name}: required, missing`);
  for (const [name, item] of Object.entries(object)) {
    const property = properties[name];
    if (!property) {
      if (schema.additionalProperties === false)
        found.push(`${at}.${name}: not in the spec`);
    } else if ('properties' in property || 'items' in property)
      found.push(`${at}.${name}: a nested schema this checker does not read`);
    else found.push(...leafFindings(doc, property, item, `${at}.${name}`));
  }
  return found;
}

export function operation(
  doc: OpenApiDoc,
  path: string,
  method: string,
): Operation {
  const op = doc.paths?.[path]?.[method];
  if (!op) throw new Error(`the spec has no ${method.toUpperCase()} ${path}`);
  return op;
}

export const documentedStatuses = (
  doc: OpenApiDoc,
  path: string,
  method: string,
): string[] => Object.keys(operation(doc, path, method).responses ?? {});

/** What a check against the spec found, and every point it checked. */
export interface Verdict {
  readonly findings: string[];
  readonly checked: string[];
}

/**
 * Every way `response` disagrees with the spec (`findings`, empty when it
 * agrees), and every point it compared (`checked`), so a caller can show the
 * absence of findings was read over something.
 */
export async function checkResponse(
  doc: OpenApiDoc,
  path: string,
  method: string,
  response: Response,
): Promise<Verdict> {
  const checked = [`status ${response.status}`];
  const documented = operation(doc, path, method).responses?.[
    String(response.status)
  ];
  if (!documented)
    return {
      findings: [`status ${response.status} is not documented`],
      checked,
    };
  const findings: string[] = [];
  for (const [name, header] of Object.entries(documented.headers ?? {}))
    if (header.required) {
      checked.push(`header ${name}`);
      if (response.headers.get(name) === null)
        findings.push(`header ${name}: documented as required, missing`);
    }
  const type = (response.headers.get('Content-Type') ?? '')
    .split(';')[0]
    .trim();
  const text = await response.text();
  checked.push('body');
  const content = documented.content;
  if (!content) {
    if (text !== '')
      findings.push(`a body the spec does not document: ${text.slice(0, 80)}`);
    return { findings, checked };
  }
  // Form mode answers some statuses with no body; the spec says so, never the checker.
  if (text === '' && type === '' && documented['x-empty-in-form-mode'] === true)
    return { findings, checked };
  const media = content[type];
  if (!media) {
    findings.push(`content type ${type || '(none)'} is not documented`);
    return { findings, checked };
  }
  const body: unknown = JSON.parse(text);
  if (body && typeof body === 'object')
    checked.push(...Object.keys(body).map((key) => `body.${key}`));
  findings.push(...validate(doc, media.schema, body, 'body'));
  return { findings, checked };
}

/** The `enum` a form field's schema declares. */
export function formEnum(
  doc: OpenApiDoc,
  path: string,
  field: string,
): unknown[] {
  const schema = operation(doc, path, 'post').requestBody?.content[
    'application/x-www-form-urlencoded'
  ]?.schema;
  const property = (schema?.properties as Record<string, Schema> | undefined)?.[
    field
  ];
  if (!Array.isArray(property?.enum))
    throw new Error(`POST ${path}: the form field ${field} declares no enum`);
  return property.enum;
}
