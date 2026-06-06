/**
 * Symbol extraction for the agent's context builder.
 *
 * Provides symbol-level retrieval (functions, classes, methods, …) instead of
 * full-file retrieval, so the agent can pull just the relevant declaration
 * from a large file.
 *
 * Implemented on the CodeMirror/Lezer parsers that already ship in the editor
 * bundle, rather than a second set of tree-sitter grammars in the Rust binary.
 * Reusing the already-bundled parsers keeps this capability at ~zero added
 * binary size. File contents are read through the existing `read_file_content`
 * command and parsed in-process.
 */
import { invoke } from '@tauri-apps/api/core';
import { javascriptLanguage, jsxLanguage, typescriptLanguage, tsxLanguage } from '@codemirror/lang-javascript';
import { pythonLanguage } from '@codemirror/lang-python';
import { rustLanguage } from '@codemirror/lang-rust';

export interface Symbol {
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  body: string;
}

// All exposed parsers share the same LRParser shape; borrow it from one of them
// so we don't need a direct dependency on `@lezer/lr`.
type LezerParser = typeof javascriptLanguage.parser;

/** Minimal structural view of a Lezer SyntaxNode — avoids a direct `@lezer/common` import. */
interface SyntaxNodeLike {
  getChild(type: string): { from: number; to: number } | null;
}

/** Select the parser for a file extension, or null for unsupported languages. */
function parserForExtension(ext: string): LezerParser | null {
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascriptLanguage.parser;
    case 'jsx':
      return jsxLanguage.parser;
    case 'ts':
    case 'mts':
    case 'cts':
      return typescriptLanguage.parser;
    case 'tsx':
      return tsxLanguage.parser;
    case 'py':
    case 'pyi':
      return pythonLanguage.parser;
    case 'rs':
      return rustLanguage.parser;
    default:
      return null;
  }
}

/** Lezer node type → emitted symbol kind. */
const KIND_BY_NODE: Record<string, string> = {
  // JavaScript / TypeScript
  FunctionDeclaration: 'function',
  ArrowFunction: 'function',
  ClassDeclaration: 'class',
  MethodDeclaration: 'method',
  InterfaceDeclaration: 'interface',
  TypeAliasDeclaration: 'type',
  // Rust
  FunctionItem: 'function',
  StructItem: 'struct',
  EnumItem: 'enum',
  TraitItem: 'trait',
  ImplItem: 'impl',
  TypeItem: 'type',
  // Python
  FunctionDefinition: 'function',
  ClassDefinition: 'class',
};

// Function-like nodes: capture the node itself but don't descend into its body
// (mirrors the previous "dominated" logic so nested locals aren't emitted).
const FUNCTION_LIKE = new Set([
  'FunctionDeclaration',
  'ArrowFunction',
  'MethodDeclaration',
  'FunctionItem',
  'FunctionDefinition',
]);

// Candidate child node types that hold a declaration's name, across grammars.
const NAME_CHILD_TYPES = [
  'VariableDefinition',
  'PropertyDefinition',
  'PropertyName',
  'TypeDefinition',
  'VariableName',
  'BoundIdentifier',
  'TypeIdentifier',
  'Name',
];

function nameOf(node: SyntaxNodeLike, source: string): string | null {
  for (const type of NAME_CHILD_TYPES) {
    const child = node.getChild(type);
    if (child) return source.slice(child.from, child.to);
  }
  return null;
}

/** Build a 1-based line lookup from char offsets via binary search over line starts. */
function makeLineLookup(source: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Parse source and extract its top-level (and class-member) symbols. */
export function extractSymbolsFromSource(source: string, extension: string): Symbol[] {
  const parser = parserForExtension(extension);
  if (!parser) return [];

  const tree = parser.parse(source);
  const lineAt = makeLineLookup(source);
  const symbols: Symbol[] = [];

  tree.iterate({
    enter: (ref) => {
      const kind = KIND_BY_NODE[ref.name];
      if (kind) {
        const name = nameOf(ref.node as unknown as SyntaxNodeLike, source);
        if (name) {
          const body = source.slice(ref.from, ref.to);
          // Skip very short symbols (likely noise) — matches prior behavior.
          if (body.length >= 10) {
            symbols.push({
              name,
              kind,
              start_line: lineAt(ref.from),
              end_line: lineAt(ref.to),
              body,
            });
          }
        }
      }
      // Don't descend into function bodies (but do descend into classes/impls
      // so their methods are captured).
      if (FUNCTION_LIKE.has(ref.name)) return false;
      return undefined;
    },
  });

  return symbols;
}

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Extract all symbols from a file.
 */
export async function extractSymbols(path: string): Promise<Symbol[]> {
  try {
    const source = await invoke<string>('read_file_content', { path });
    return extractSymbolsFromSource(source, extensionOf(path));
  } catch {
    return [];
  }
}

/**
 * Get a specific symbol's body by name.
 */
export async function getSymbolBody(path: string, symbolName: string): Promise<string | null> {
  const symbols = await extractSymbols(path);
  const match = symbols.find((s) => s.name === symbolName);
  return match ? match.body : null;
}
