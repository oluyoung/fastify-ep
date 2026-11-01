import { readFileSync, readdirSync, statSync } from 'node:fs';
import { posix, sep } from 'node:path';

/*
 * A small import scanner for the architecture checks. It reads TypeScript source as tokens (skipping
 * comments, strings, template literals and regular expressions) and finds the module specifiers a
 * file imports. It does not use the TypeScript compiler and does not resolve path aliases or
 * `node_modules`: generated projects use relative imports, and a project that does more simply gets
 * fewer findings, never wrong ones.
 */

export type ImportKind = 'static' | 'export-from' | 'dynamic';

export interface ImportRef {
  specifier: string;
  kind: ImportKind;
  /** `import type`, `export type`, or an import where every named binding is `type`-prefixed. */
  typeOnly: boolean;
  line: number;
}

export type FileRole =
  'module' | 'controller' | 'service' | 'repository' | 'schema' | 'table' | 'test' | 'other';

export interface ScannedImport extends ImportRef {
  /** The project-relative file a relative specifier points at (`src/modules/users/users.service.ts`). */
  resolved?: string;
  /** The package a bare specifier names (`fastify`, `@sinclair/typebox`, `node:fs`). */
  package?: string;
}

/** A `// fastify-ep-ignore <rule-id>` comment; it silences findings on the line after `line`. */
export interface IgnoreDirective {
  line: number;
  /** The rule ids named; empty for a bare `fastify-ep-ignore`. */
  rules: string[];
}

export interface ScannedFile {
  /** Project-relative, forward slashes. */
  path: string;
  /** The `src/modules/<name>/` directory the file is in. */
  module?: string;
  role: FileRole;
  imports: ScannedImport[];
  ignores: IgnoreDirective[];
}

export interface ProjectScan {
  files: ScannedFile[];
  /** Files that could not be read or tokenised, with the reason; never a failure. */
  unparsed: Array<{ path: string; reason: string }>;
}

interface Token {
  kind: 'word' | 'punct' | 'string' | 'template' | 'regex';
  text: string;
  line: number;
}

class TokenizeError extends Error {}

const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'delete',
  'void',
  'throw',
  'in',
  'of',
  'new',
  'else',
  'do',
  'instanceof',
  'yield',
  'await',
]);
const REGEX_AFTER_PUNCT = new Set('(,=:[!&|?{;+-*%<>~^'.split(''));
const WORD_CHAR = /[\w$]/;

const IGNORE_MARKER = 'fastify-ep-ignore';
const RULE_ID = /[A-Z]+-\d{3}\/[\w-]+/g;

/** The directive in a comment's text, if it has one; `line` is the comment's last line. */
function ignoreDirective(comment: string, line: number): IgnoreDirective | undefined {
  const at = comment.indexOf(IGNORE_MARKER);
  if (at === -1) return undefined;
  return { line, rules: comment.slice(at + IGNORE_MARKER.length).match(RULE_ID) ?? [] };
}

function tokenize(source: string): { tokens: Token[]; ignores: IgnoreDirective[] } {
  const tokens: Token[] = [];
  const ignores: IgnoreDirective[] = [];
  /** Brace depth at each open `${`, so the matching `}` resumes the template. */
  const templateDepths: number[] = [];
  let depth = 0;
  let line = 1;
  let i = 0;

  /** Reads template text from `i`; returns after the closing backtick or the next `${`. */
  const readTemplate = (): void => {
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
      } else if (ch === '`') {
        i += 1;
        return;
      } else if (ch === '$' && source[i + 1] === '{') {
        templateDepths.push(depth);
        i += 2;
        return;
      } else {
        if (ch === '\n') line += 1;
        i += 1;
      }
    }
    throw new TokenizeError(`unterminated template literal near line ${line}`);
  };

  const regexAllowed = (): boolean => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.kind === 'word') return REGEX_AFTER_WORD.has(prev.text);
    if (prev.kind === 'punct') return REGEX_AFTER_PUNCT.has(prev.text);
    return false;
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '\n') {
      line += 1;
      i += 1;
    } else if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '/' && next === '/') {
      const start = i;
      while (i < source.length && source[i] !== '\n') i += 1;
      const directive = ignoreDirective(source.slice(start, i), line);
      if (directive) ignores.push(directive);
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new TokenizeError(`unterminated comment near line ${line}`);
      const comment = source.slice(i, end);
      for (const c of comment) if (c === '\n') line += 1;
      const directive = ignoreDirective(comment, line);
      if (directive) ignores.push(directive);
      i = end + 2;
    } else if (ch === '"' || ch === "'") {
      const start = i + 1;
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') i += 1;
        if (source[i] === '\n') throw new TokenizeError(`unterminated string near line ${line}`);
        i += 1;
      }
      if (i >= source.length) throw new TokenizeError(`unterminated string near line ${line}`);
      tokens.push({ kind: 'string', text: source.slice(start, i), line });
      i += 1;
    } else if (ch === '`') {
      tokens.push({ kind: 'template', text: '`', line });
      i += 1;
      readTemplate();
    } else if (ch === '/' && regexAllowed()) {
      i += 1;
      let inClass = false;
      while (i < source.length && (source[i] !== '/' || inClass)) {
        if (source[i] === '\\') i += 1;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        if (source[i] === '\n')
          throw new TokenizeError(`unterminated regular expression near line ${line}`);
        i += 1;
      }
      if (i >= source.length)
        throw new TokenizeError(`unterminated regular expression near line ${line}`);
      tokens.push({ kind: 'regex', text: '/', line });
      i += 1;
    } else if (WORD_CHAR.test(ch)) {
      const start = i;
      while (i < source.length && WORD_CHAR.test(source[i])) i += 1;
      tokens.push({ kind: 'word', text: source.slice(start, i), line });
    } else if (ch === '{') {
      depth += 1;
      tokens.push({ kind: 'punct', text: ch, line });
      i += 1;
    } else if (ch === '}') {
      i += 1;
      if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth) {
        templateDepths.pop();
        readTemplate();
      } else {
        depth -= 1;
        tokens.push({ kind: 'punct', text: ch, line });
      }
    } else {
      tokens.push({ kind: 'punct', text: ch, line });
      i += 1;
    }
  }
  if (templateDepths.length > 0) throw new TokenizeError('unterminated template expression');
  return { tokens, ignores };
}

const MAX_CLAUSE_TOKENS = 5000;

/** True when the tokens between `import`/`export` and `from` bring in nothing at runtime. */
function clauseIsTypeOnly(clause: Token[]): boolean {
  if (
    clause.length > 1 &&
    clause[0].text === 'type' &&
    clause[1].text !== 'from' &&
    clause[1].text !== ','
  ) {
    return true;
  }
  // `import { type A, type B }`: no default or namespace binding, and every named binding is a type.
  const open = clause.findIndex((t) => t.text === '{');
  if (open !== 0) return false;
  const names: Token[][] = [[]];
  for (const token of clause.slice(1)) {
    if (token.text === '}') break;
    if (token.text === ',') names.push([]);
    else names[names.length - 1].push(token);
  }
  const named = names.filter((n) => n.length > 0);
  return named.length > 0 && named.every((n) => n[0].text === 'type' && n.length > 1);
}

/** Every import, re-export and dynamic `import()` with a string specifier in the source. */
export function extractImports(source: string): ImportRef[] {
  return analyzeSource(source).imports;
}

/** The imports and `fastify-ep-ignore` comments of one file. */
export function analyzeSource(source: string): {
  imports: ImportRef[];
  ignores: IgnoreDirective[];
} {
  const { tokens, ignores } = tokenize(source);
  const found: ImportRef[] = [];

  /** The clause tokens before `from 'x'`, starting at `start`, or undefined when there is none. */
  const readClause = (start: number): { clause: Token[]; specifier: Token } | undefined => {
    let braces = 0;
    for (let j = start; j < tokens.length && j - start < MAX_CLAUSE_TOKENS; j += 1) {
      const token = tokens[j];
      if (token.kind === 'punct') {
        if (token.text === '{') braces += 1;
        else if (token.text === '}') braces -= 1;
        else if (token.text === ';' && braces === 0) return undefined;
      }
      if (braces === 0 && token.kind === 'word' && token.text === 'from') {
        const specifier = tokens[j + 1];
        if (specifier?.kind === 'string') return { clause: tokens.slice(start, j), specifier };
        return undefined;
      }
    }
    return undefined;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== 'word') continue;
    const after = tokens[i + 1];
    const prev = tokens[i - 1];
    if (prev?.text === '.') continue; // `obj.import`, `obj.export`

    if (token.text === 'import') {
      if (after?.kind === 'string') {
        found.push({ specifier: after.text, kind: 'static', typeOnly: false, line: token.line });
      } else if (after?.text === '(') {
        const arg = tokens[i + 2];
        if (arg?.kind === 'string' && tokens[i + 3]?.text === ')') {
          found.push({ specifier: arg.text, kind: 'dynamic', typeOnly: false, line: token.line });
        }
      } else if (after && after.text !== '.') {
        const read = readClause(i + 1);
        if (read) {
          found.push({
            specifier: read.specifier.text,
            kind: 'static',
            typeOnly: clauseIsTypeOnly(read.clause),
            line: token.line,
          });
        }
      }
    } else if (
      token.text === 'export' &&
      (after?.text === '*' || after?.text === '{' || after?.text === 'type')
    ) {
      const read = readClause(i + 1);
      if (read) {
        found.push({
          specifier: read.specifier.text,
          kind: 'export-from',
          typeOnly: read.clause[0]?.text === 'type' || clauseIsTypeOnly(read.clause),
          line: token.line,
        });
      }
    }
  }
  return { imports: found, ignores };
}

/** The lines where the source calls a method called `name` (`x.listen(...)`, `x?.listen(...)`). */
export function findMethodCalls(source: string, name: string): number[] {
  const { tokens } = tokenize(source);
  const lines: number[] = [];
  for (let i = 1; i < tokens.length - 1; i += 1) {
    if (tokens[i].text === name && tokens[i - 1].text === '.' && tokens[i + 1].text === '(') {
      lines.push(tokens[i].line);
    }
  }
  return lines;
}

const ROLE_SUFFIXES: Array<[string, FileRole]> = [
  ['.test.ts', 'test'],
  ['.spec.ts', 'test'],
  ['.module.ts', 'module'],
  ['.controller.ts', 'controller'],
  ['.service.ts', 'service'],
  ['.repository.ts', 'repository'],
  ['.schema.ts', 'schema'],
  ['.table.ts', 'table'],
];

/** The role a file plays, from its name (`users.service.ts` is a service). */
export function fileRole(path: string): FileRole {
  const match = ROLE_SUFFIXES.find(([suffix]) => path.endsWith(suffix));
  return match ? match[1] : 'other';
}

/** The module a project-relative path belongs to (`src/modules/<name>/...`), if any. */
export function moduleOf(path: string): string | undefined {
  return /^src\/modules\/([^/]+)\//.exec(path)?.[1];
}

/** `fastify`, `@sinclair/typebox/value` -> `@sinclair/typebox`, `node:fs` -> `node:fs`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Maps `./a.js` to the `.ts` file TypeScript means; the file on disk wins when there is one. */
function resolveRelative(root: string, fromPath: string, specifier: string): string {
  const target = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const candidates = [
    target.replace(/\.(m|c)?js$/, '.ts'),
    `${target}.ts`,
    posix.join(target, 'index.ts'),
  ];
  const onDisk = candidates.find((candidate) => isFile(posix.join(root, candidate)));
  return onDisk ?? candidates[0];
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

function listSourceFiles(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(posix.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)) {
        listSourceFiles(root, path, out);
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
}

/** Scans `src/**` of the project at `root`, leaving out tests. */
export function scanProject(root: string): ProjectScan {
  const posixRoot = root.split(sep).join('/');
  const paths: string[] = [];
  listSourceFiles(posixRoot, 'src', paths);

  const files: ScannedFile[] = [];
  const unparsed: ProjectScan['unparsed'] = [];
  for (const path of paths) {
    const role = fileRole(path);
    if (role === 'test') continue;
    try {
      const { imports: refs, ignores } = analyzeSource(
        readFileSync(posix.join(posixRoot, path), 'utf8'),
      );
      files.push({
        path,
        module: moduleOf(path),
        role,
        imports: refs.map((ref) =>
          ref.specifier.startsWith('.')
            ? { ...ref, resolved: resolveRelative(posixRoot, path, ref.specifier) }
            : { ...ref, package: packageOf(ref.specifier) },
        ),
        ignores,
      });
    } catch (err) {
      unparsed.push({ path, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { files, unparsed };
}
