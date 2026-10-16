import ts from 'typescript';
import { dirname, join } from 'node:path';

/**
 * Which iPhone mirrors lean on a harness stand-in for a Playwright algorithm,
 * and which of those say so (#821). The mirror rule (global, 2026-10-16) keeps
 * a stand-in, marked in its test `NOT YET THE SAME as Android (#811)`, until
 * #811 makes it the same; twice a stand-in went unmarked in a test that
 * reached it through a helper, so this reads calls, not text.
 *
 * Every function binding in every file given is keyed by file and name, and
 * an identifier resolves to its own file's binding, else to the binding its
 * relative import names. A binding is tainted when it is a seed, or when its
 * body reaches a tainted binding; that is iterated to a fixed point. Each
 * `test(...)` call in a `*.journey.ts` file is read; one whose body reaches a
 * tainted binding is judged; a judged test with no marker in a COMMENT inside
 * it is a finding. Entries read `<file>:<line> <title>`.
 */
export const STAND_IN_MARKER = 'NOT YET THE SAME as Android (#811)';

export interface StandInSeed {
  file: string;
  names: readonly string[];
}

/** A node that opens a scope its declarations live in. */
const isScope = (node: ts.Node): boolean =>
  ts.isSourceFile(node) ||
  ts.isBlock(node) ||
  ts.isFunctionLike(node) ||
  ts.isForOfStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForStatement(node) ||
  ts.isCatchClause(node);

const scopeOf = (node: ts.Node): ts.Node => {
  let at = node.parent;
  while (!isScope(at)) at = at.parent;
  return at;
};

/** A function binding: a function declaration, or a const whose value is a function. */
const functionBody = (declaration: ts.Node): ts.Node | undefined => {
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  )
    return declaration;
  return undefined;
};

/** An identifier that names something, not a property read off an object or a key. */
const isReference = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return true;
};

const commentsIn = (source: ts.SourceFile, node: ts.Node): string[] => {
  const text = source.getFullText();
  const seen = new Set<number>();
  const found: string[] = [];
  const visit = (at: ts.Node): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, at.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(text, at.getEnd()) ?? []),
    ])
      if (
        range.pos >= node.getStart(source) &&
        range.end <= node.getEnd() &&
        !seen.has(range.pos)
      ) {
        seen.add(range.pos);
        found.push(text.slice(range.pos, range.end));
      }
    ts.forEachChild(at, visit);
  };
  ts.forEachChild(node, visit);
  return found;
};

export function standIns(
  files: Readonly<Record<string, string>>,
  seeds: readonly StandInSeed[],
): { read: string[]; judged: string[]; findings: string[] } {
  const sources = Object.entries(files).map(([file, text]) => ({
    file,
    source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  }));
  // Every declared name, by the scope it lives in: a function binding keeps
  // its node, anything else (a parameter, a value) only shadows.
  const declared = new Map<ts.Node, Map<string, ts.Node>>();
  const declare = (scope: ts.Node, name: string, node: ts.Node): void => {
    if (!declared.has(scope)) declared.set(scope, new Map());
    declared.get(scope)!.set(name, node);
  };
  const imports = new Map<ts.Node, { file: string; name: string }>();
  const topLevel = new Map<string, Map<string, ts.Node>>();
  for (const { file, source } of sources) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isBindingElement(node)) &&
        node.name !== undefined &&
        ts.isIdentifier(node.name)
      ) {
        const scope = ts.isParameter(node) ? node.parent : scopeOf(node);
        declare(scope, node.name.text, node);
        if (ts.isSourceFile(scope)) {
          if (!topLevel.has(file)) topLevel.set(file, new Map());
          topLevel.get(file)!.set(node.name.text, node);
        }
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith('.') &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        const target = `${join(dirname(file), node.moduleSpecifier.text)}.ts`;
        for (const element of node.importClause.namedBindings.elements) {
          declare(source, element.name.text, element);
          imports.set(element, {
            file: target,
            name: (element.propertyName ?? element.name).text,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  /** The declaration `identifier` names: the nearest scope's, through imports. */
  const resolve = (identifier: ts.Identifier): ts.Node | undefined => {
    for (let at: ts.Node = identifier; at !== undefined; at = at.parent) {
      if (!isScope(at)) continue;
      const found = declared.get(at)?.get(identifier.text);
      if (found === undefined) continue;
      const via = imports.get(found);
      return via === undefined ? found : topLevel.get(via.file)?.get(via.name);
    }
    return undefined;
  };

  const tainted = new Set<ts.Node>();
  for (const { file, names } of seeds)
    for (const name of names) {
      const found = topLevel.get(file)?.get(name);
      if (found === undefined || functionBody(found) === undefined)
        throw new Error(`${file} declares no ${name}`);
      tainted.add(found);
    }

  const reaches = (node: ts.Node): boolean => {
    let hit = false;
    const visit = (at: ts.Node): void => {
      if (hit) return;
      if (ts.isIdentifier(at) && isReference(at)) {
        const target = resolve(at);
        if (target !== undefined && tainted.has(target)) hit = true;
      }
      ts.forEachChild(at, visit);
    };
    ts.forEachChild(node, visit);
    return hit;
  };

  const bindings = [...declared.values()]
    .flatMap((names) => [...names.values()])
    .filter((node) => functionBody(node) !== undefined);
  for (let grew = true; grew; ) {
    grew = false;
    for (const binding of bindings) {
      if (tainted.has(binding)) continue;
      if (reaches(binding)) {
        tainted.add(binding);
        grew = true;
      }
    }
  }

  const read: string[] = [];
  const judged: string[] = [];
  const findings: string[] = [];
  for (const { file, source } of sources) {
    if (!file.endsWith('.journey.ts')) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        /^test(\.\w+)?$/.test(node.expression.getText(source)) &&
        node.arguments.length >= 2
      ) {
        const title = node.arguments[0]!.getText(source).slice(1, -1);
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const entry = `${file}:${line} ${title}`;
        read.push(entry);
        if (reaches(node.arguments[1]!)) {
          judged.push(entry);
          if (
            !commentsIn(source, node).some((c) => c.includes(STAND_IN_MARKER))
          )
            findings.push(entry);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { read, judged, findings };
}
