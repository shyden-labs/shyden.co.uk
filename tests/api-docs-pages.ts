import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { parse } from 'yaml';

/**
 * The API docs pages (#781), for the e2e and sanity suites alike: what each
 * page documents, read from its own route rather than listed here, and the
 * one check that a page drew its operations.
 */

/** The `openapi/*.yaml` a docs route inlines, read from the route's source. */
export function docsSpecFile(path: string): string {
  const name = path.replace(/^\/api\/docs\/|\/$/g, '') || 'index';
  const route = readFileSync(`src/pages/api/docs/${name}.astro`, 'utf8');
  const found = route.match(/openapi\/[\w-]+\.yaml(?=\?raw)/g) ?? [];
  if (found.length !== 1)
    throw new Error(
      `${path}: its route names ${found.length} specs, so which one it shows is not known`,
    );
  return found[0];
}

interface FormSchema {
  required?: string[];
  properties?: Record<string, { type?: string; enum?: unknown[] }>;
}

/**
 * The form fields a spec requires that a visitor must type: required strings
 * with no fixed choices. Swagger UI will not send without them, and labels
 * each field with its name.
 */
export function requiredTextFields(specFile: string): string[] {
  const doc = parse(readFileSync(specFile, 'utf8')) as {
    paths: Record<
      string,
      Record<
        string,
        { requestBody?: { content: Record<string, { schema: FormSchema }> } }
      >
    >;
  };
  return Object.values(doc.paths)
    .flatMap((operations) => Object.values(operations))
    .flatMap((operation) => Object.values(operation.requestBody?.content ?? {}))
    .flatMap(({ schema }) =>
      (schema.required ?? []).filter((name) => {
        const property = schema.properties?.[name];
        return property?.type === 'string' && !property.enum;
      }),
    );
}

/** The docs page at `path` answers 200 and Swagger UI draws an operation. */
export async function expectDocsRendered(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.locator('#swagger .opblock').first()).toBeVisible();
}
