/**
 * Native tool definitions for the agent loop.
 *
 * Each tool has:
 * - A JSON schema (OpenAI function-calling format)
 * - A dispatch function that executes the tool and returns a string result
 *
 * The schemas are sent to the model via the `tools` parameter.
 * The dispatch function is called when the model returns a tool_call.
 */
import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { runInAgentSession, formatCommandResult } from './agentShell';
import { aiProvider, aiModel } from './ai';
import { getCustomAgent, parseTodoItems, setAgentTodos, formatTodos } from './agents';

// ── Tool Schema Types (OpenAI format) ──

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParameter>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  success: boolean;
}

// ── Tool Definitions ──

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content as text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing a range of lines with new content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          start_line: { type: 'string', description: '1-indexed start line number' },
          end_line: { type: 'string', description: '1-indexed end line number' },
          new_content: { type: 'string', description: 'The new code to replace the specified lines' },
        },
        required: ['path', 'start_line', 'end_line', 'new_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command and return its output. Use for builds, tests, linting.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files by name pattern in the project.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (matches against file paths)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents for a regex pattern across the project (ripgrep-style, gitignore-aware). Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Optional subdirectory (relative to project root) to limit search scope' },
          glob: { type: 'string', description: 'Optional glob to filter files, e.g. "*.rs" or "src/**/*.ts"' },
          case_insensitive: { type: 'string', description: 'Set to "true" for case-insensitive matching' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob_files',
      description: 'Find files whose path matches a glob pattern (gitignore-aware), e.g. "**/*.test.ts".',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match against project-relative paths' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_background',
      description: 'Start a long-running command (e.g. a dev server or watcher) as a background process. Returns a handle; use read_background to tail its output. Does NOT block.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run in the background' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_background',
      description: 'Read new output from a background process by handle. Pass the previous "next offset" as `since` to tail incrementally.',
      parameters: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Background process handle (number)' },
          since: { type: 'string', description: 'Byte offset to read from (default 0)' },
        },
        required: ['handle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_background',
      description: 'Terminate a background process by handle.',
      parameters: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Background process handle (number)' },
        },
        required: ['handle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo',
      description: 'Record or update your task list for a multi-step request. Pass the full list each time; lines beginning with [x] are completed, [ ] are pending.',
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'string', description: 'Newline-separated tasks, e.g. "[x] read files\\n[ ] write tests".' },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_subagent',
      description: 'Delegate a focused sub-task to a configured custom agent and return its response. Use for specialized review or analysis.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Id of the custom agent to consult.' },
          task: { type: 'string', description: 'The task or question for the sub-agent.' },
        },
        required: ['agent_id', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories at a given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to project root (empty string for root)' },
        },
        required: ['path'],
      },
    },
  },
];

// ── Tool Names (for type safety) ──

export type ToolName = 'read_file' | 'edit_file' | 'run_command' | 'search_files' | 'grep' | 'glob_files' | 'run_background' | 'read_background' | 'kill_background' | 'todo' | 'run_subagent' | 'list_dir';

export const ALL_TOOL_NAMES: ToolName[] = ['read_file', 'edit_file', 'run_command', 'search_files', 'grep', 'glob_files', 'run_background', 'read_background', 'kill_background', 'todo', 'run_subagent', 'list_dir'];

// ── Dispatch ──

export interface DispatchContext {
  projectRoot: string;
  /** Called when an edit is proposed (for pending-edit flow) */
  onEdit?: (path: string, startLine: number, endLine: number, newContent: string, originalCode: string) => void;
  /** Called when a command needs approval */
  onCommandBlocked?: (command: string) => void;
}

/**
 * Parse tool call arguments safely.
 * Models sometimes return malformed JSON — this handles common issues.
 */
export function parseToolArgs(argsJson: string): Record<string, string> {
  try {
    return JSON.parse(argsJson);
  } catch {
    // Try to recover from common model mistakes (trailing commas, etc.)
    try {
      const cleaned = argsJson.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      return JSON.parse(cleaned);
    } catch {
      return {};
    }
  }
}

/**
 * Dispatch a tool call and return the result string.
 */
export async function dispatchTool(
  toolCall: ToolCall,
  ctx: DispatchContext,
): Promise<ToolResult> {
  const name = toolCall.function.name as ToolName;
  const args = parseToolArgs(toolCall.function.arguments);

  try {
    const content = await executeTool(name, args, ctx);
    return { tool_call_id: toolCall.id, content, success: true };
  } catch (e) {
    return { tool_call_id: toolCall.id, content: `Error: ${e}`, success: false };
  }
}

async function executeTool(
  name: ToolName,
  args: Record<string, string>,
  ctx: DispatchContext,
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const path = resolvePath(args.path, ctx.projectRoot);
      const content = await invoke<string>('read_file_content', { path });
      // Truncate large files to avoid blowing context
      const MAX = 8000;
      if (content.length > MAX) {
        return content.slice(0, MAX) + `\n\n... (truncated, ${content.length - MAX} more chars)`;
      }
      return content;
    }

    case 'edit_file': {
      const path = resolvePath(args.path, ctx.projectRoot);
      const startLine = parseInt(args.start_line, 10);
      const endLine = parseInt(args.end_line, 10);
      if (isNaN(startLine) || isNaN(endLine)) {
        throw new Error('start_line and end_line must be numbers');
      }
      // Always read the file to get original code for diff display
      const fileContent = await invoke<string>('read_file_content', { path });
      const fileLines = fileContent.split('\n');
      const originalCode = fileLines.slice(startLine - 1, endLine).join('\n');

      if (ctx.onEdit) {
        ctx.onEdit(path, startLine, endLine, args.new_content, originalCode);
        return `Edit proposed for ${args.path} lines ${startLine}-${endLine}. Waiting for approval.`;
      }
      // Auto-apply mode
      const before = fileLines.slice(0, startLine - 1);
      const after = fileLines.slice(endLine);
      const newContent = [...before, ...args.new_content.split('\n'), ...after].join('\n');
      await invoke('write_file_content', { path, content: newContent });
      return `Applied edit to ${args.path} lines ${startLine}-${endLine}.`;
    }

    case 'run_command': {
      const command = args.command;
      if (!command) throw new Error('command is required');
      try {
        const result = await runInAgentSession(command, ctx.projectRoot, 30000);
        return formatCommandResult(result);
      } catch {
        try {
          const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
            'run_command_capture',
            { command, cwd: ctx.projectRoot, timeoutMs: 30000 }
          );
          return formatCommandResult(result);
        } catch {
          if (ctx.onCommandBlocked) {
            ctx.onCommandBlocked(command);
            return `Command "${command}" requires approval.`;
          }
          return `Command execution not available. Command: ${command}`;
        }
      }
    }

    case 'search_files': {
      const query = (args.query || '').toLowerCase();
      const files = await invoke<string[]>('list_all_files', { path: ctx.projectRoot });
      const matches = files
        .filter(f => f.toLowerCase().includes(query))
        .slice(0, 20);
      return matches.length > 0 ? matches.join('\n') : 'No files found.';
    }

    case 'grep': {
      const pattern = args.pattern;
      if (!pattern) throw new Error('pattern is required');
      const root = args.path ? resolvePath(args.path, ctx.projectRoot) : ctx.projectRoot;
      const res = await invoke<{ hits: { rel: string; line: number; text: string }[]; truncated: boolean }>('fs_grep', {
        pattern,
        root,
        glob: args.glob ? [args.glob] : null,
        caseInsensitive: args.case_insensitive === 'true' ? true : null,
        maxResults: 100,
      });
      if (res.hits.length === 0) return `No matches for "${pattern}".`;
      const lines = res.hits.map(h => `${h.rel}:${h.line}: ${h.text.trim()}`);
      if (res.truncated) lines.push('... (truncated)');
      return lines.join('\n');
    }

    case 'glob_files': {
      const pattern = args.pattern;
      if (!pattern) throw new Error('pattern is required');
      const res = await invoke<{ hits: { rel: string }[]; truncated: boolean }>('fs_glob', {
        pattern,
        root: ctx.projectRoot,
        maxResults: 200,
      });
      if (res.hits.length === 0) return `No files match "${pattern}".`;
      const out = res.hits.map(h => h.rel);
      if (res.truncated) out.push('... (truncated)');
      return out.join('\n');
    }

    case 'run_background': {
      const command = args.command;
      if (!command) throw new Error('command is required');
      const handle = await invoke<number>('shell_bg_spawn', { command, cwd: ctx.projectRoot });
      return `Started background process #${handle}: ${command}\nUse read_background with handle ${handle} to read its output.`;
    }

    case 'read_background': {
      const handle = parseInt(args.handle, 10);
      if (isNaN(handle)) throw new Error('handle must be a number');
      const since = args.since ? parseInt(args.since, 10) : 0;
      const res = await invoke<{ bytes: string; next_offset: number; exited: boolean; exit_code: number | null }>(
        'shell_bg_logs', { handle, sinceOffset: since },
      );
      let out = res.bytes || '(no new output)';
      const MAX = 4000;
      if (out.length > MAX) out = out.slice(-MAX);
      const status = res.exited ? `\n[exited${res.exit_code != null ? ` with code ${res.exit_code}` : ''}]` : '';
      return `${out}${status}\n[next offset: ${res.next_offset}]`;
    }

    case 'kill_background': {
      const handle = parseInt(args.handle, 10);
      if (isNaN(handle)) throw new Error('handle must be a number');
      await invoke('shell_bg_kill', { handle });
      return `Killed background process #${handle}.`;
    }

    case 'todo': {
      const items = parseTodoItems(args.items || '');
      setAgentTodos(items);
      return formatTodos(items);
    }

    case 'run_subagent': {
      if (!args.agent_id) throw new Error('agent_id is required');
      if (!args.task) throw new Error('task is required');
      const agent = getCustomAgent(args.agent_id);
      if (!agent) throw new Error(`No custom agent with id "${args.agent_id}".`);
      const prompt = `${agent.systemPrompt}\n\nTask:\n${args.task}`;
      const out = await invoke<string>('ai_chat', {
        request: { prompt, provider: get(aiProvider), model: get(aiModel) },
      });
      return `[${agent.name}]\n${out}`;
    }

    case 'list_dir': {
      const dirPath = args.path
        ? resolvePath(args.path, ctx.projectRoot)
        : ctx.projectRoot;
      const entries = await invoke<{ name: string; is_dir: boolean }[]>('read_dir_tree', { path: dirPath, depth: 1 });
      return entries
        .map(e => `${e.is_dir ? '📁' : '📄'} ${e.name}`)
        .slice(0, 50)
        .join('\n') || '(empty directory)';
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Helpers ──

function resolvePath(relativePath: string, projectRoot: string): string {
  if (!relativePath) throw new Error('path is required');
  // Resolve to absolute
  const resolved = relativePath.startsWith('/') ? relativePath : `${projectRoot}/${relativePath}`;
  // Normalize: collapse /./, resolve /../ segments
  const parts: string[] = [];
  for (const seg of resolved.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  const canonical = '/' + parts.join('/');
  // Verify the canonical path is within the project root (exact match or subpath)
  if (canonical !== projectRoot && !canonical.startsWith(projectRoot + '/')) {
    throw new Error('Path traversal not allowed: resolved path is outside project root');
  }
  return canonical;
}
