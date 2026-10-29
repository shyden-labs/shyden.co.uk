/**
 * A declarator a file writes from an imported binding's property is counted
 * (#928). Vite's SSR transform writes `const home = env.HOME`, with `env`
 * imported, as `const home = __vite_ssr_import_0__.env.HOME`, and
 * `@vitest/coverage-v8` 5.0.x ignores every declarator of that shape ("SSR
 * transformed import binding", `remapCoverage` in its `dist/provider.js`),
 * meaning to skip Vite's own bindings. It skipped the file's own declarators
 * too, so no report counted them.
 *
 * coverage-v8 builds that rule inside `remapCoverage`, where nothing can
 * reach it, so `remapCoverage` is wrapped: its own report stands, and a
 * second conversion of the same transform, ignoring every node but these
 * declarators, adds their statements to it. coverage-v8 ignores every one of
 * them, so the two never count a statement twice.
 */

import { parse } from 'vite';

/**
 * The ESTree program of a transform's code, as Vite parses it: what the
 * second conversion walks (#928).
 *
 * @param {string} code
 */
export const programOf = async (code) =>
  (await parse('transform.js', code, { lang: 'js', preserveParens: false }))
    .program;

/**
 * Whether `node` is a declarator coverage-v8 drops that the file wrote: one
 * initialised from a property of an imported binding's property, and not one
 * of Vite's own `__vite_ssr_import_N__` bindings.
 *
 * @param {any} node an ESTree node
 * @returns {boolean}
 */
export const isImportedDeclarator = (node) =>
  node?.type === 'VariableDeclarator' &&
  !(
    node.id?.type === 'Identifier' &&
    node.id.name.startsWith('__vite_ssr_import_')
  ) &&
  node.init?.type === 'MemberExpression' &&
  node.init.object?.type === 'MemberExpression' &&
  node.init.object.object?.type === 'Identifier' &&
  node.init.object.object.name.startsWith('__vite_ssr_import_');

/**
 * @typedef {{
 *   statementMap: Record<string, unknown>,
 *   s: Record<string, number>,
 * }} Statements
 */

/**
 * `into` with every statement of `from` appended to its file, after the
 * file's own. A file `from` names that `into` lacks is refused: coverage-v8
 * reported nothing for it, so there is no report to add to.
 *
 * @template {Record<string, Statements>} R
 * @param {R} into coverage-v8's report
 * @param {Record<string, Statements>} from the declarators' statements
 * @returns {R}
 */
export const addStatements = (into, from) => {
  for (const [file, extra] of Object.entries(from)) {
    const coverage = into[file];
    if (coverage === undefined)
      throw new Error(
        `coverage-declarators: ${file} has declarators to count but no coverage of its own`,
      );
    let next = Object.keys(coverage.statementMap).length;
    for (const [id, location] of Object.entries(extra.statementMap)) {
      coverage.statementMap[String(next)] = location;
      coverage.s[String(next)] = extra.s[id] ?? 0;
      next++;
    }
  }
  return into;
};

/**
 * `provider` with its `remapCoverage` counting the declarators coverage-v8
 * drops. `parse` gives the ESTree program of a transform's code, `convert`
 * is ast-v8-to-istanbul's.
 *
 * It refuses a provider without `remapCoverage`, naming it, rather than
 * leave the declarators uncounted after a Vitest upgrade.
 *
 * @template {object} P
 * @param {P} provider
 * @param {{
 *   parse: (code: string) => Promise<unknown>,
 *   convert: (options: any) => Promise<any>,
 * }} tools
 * @returns {P}
 */
export const withImportedDeclarators = (provider, { parse, convert }) => {
  const fields =
    /** @type {{ remapCoverage?: (...args: any[]) => Promise<any> }} */ (
      provider
    );
  if (typeof fields.remapCoverage !== 'function')
    throw new Error(
      'coverage-declarators: the V8 provider has no remapCoverage; a Vitest upgrade changed it, so re-check tests/coverage-declarators.mjs',
    );
  const remap = fields.remapCoverage.bind(provider);
  fields.remapCoverage = async (filename, wrapperLength, result, functions) => {
    const report = await remap(filename, wrapperLength, result, functions);
    // coverage-v8 returns nothing for a file it cannot parse.
    if (Object.keys(report).length === 0) return report;
    const declarators = await convert({
      code: result.code,
      sourceMap: result.map,
      ast: await parse(result.code),
      coverage: { functions, url: filename },
      wrapperLength,
      ignoreNode: (/** @type {unknown} */ node, /** @type {string} */ type) =>
        !(type === 'statement' && isImportedDeclarator(node)),
    });
    return addStatements(report, declarators);
  };
  return provider;
};
