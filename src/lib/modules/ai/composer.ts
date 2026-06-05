export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'clear', label: '/clear', hint: 'Clear the conversation' },
  { id: 'attach', label: '/attach', hint: 'Attach the current file' },
  { id: 'model', label: '/model', hint: 'Switch the model' },
];

/**
 * The slash query if `input` is a bare slash-command being typed (`/` then no
 * whitespace yet), else null. Once the user types a space it's a real message.
 */
export function slashQuery(input: string): string | null {
  if (!input.startsWith('/')) return null;
  if (/\s/.test(input)) return null;
  return input.slice(1);
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, '');
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(c => c.id.includes(q) || c.label.toLowerCase().includes(q));
}

/** Whether the Web Speech API is available for voice dictation. */
export function isVoiceSupported(): boolean {
  return typeof window !== 'undefined'
    && !!((window as unknown as Record<string, unknown>).SpeechRecognition
      || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);
}
