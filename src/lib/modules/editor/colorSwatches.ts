import { RangeSetBuilder, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/**
 * Renders a small colored square
 * before every hex / rgb(a) / hsl(a) literal in the document so you can see
 * what a color is without looking it up — handy in theme JSON, CSS, etc.
 * Hex swatches double as a native color picker: click to change the value
 * in place (3/4/6/8-digit hex preserved, alpha kept).
 *
 * Implemented as a StateField → `EditorView.decorations` (the same mechanism
 * leo's ghost-text / AI-diff widgets use), which renders reliably; a
 * ViewPlugin's `decorations` option did not materialize in this setup.
 */
const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?:rgba?|hsla?)\([^)]*\)/gi;

function isHex(color: string): boolean {
  return color.startsWith('#');
}

/** Normalize any hex (#rgb/#rgba/#rrggbb/#rrggbbaa) to the #rrggbb a color
 *  input expects. */
function toHex6(color: string): string {
  const h = color.slice(1);
  if (h.length === 3 || h.length === 4) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return `#${h.slice(0, 6)}`;
}

/** Re-apply a picked #rrggbb onto the original hex, preserving its alpha and
 *  shorthand-ness as much as possible. */
function applyHex(original: string, picked6: string): string {
  const h = original.slice(1);
  if (h.length === 8) return `${picked6}${h.slice(6, 8)}`;
  if (h.length === 4) return `${picked6}${h[3]}${h[3]}`;
  return picked6;
}

class SwatchWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly from: number,
    readonly to: number,
    readonly canPick: boolean,
  ) {
    super();
  }

  eq(other: SwatchWidget): boolean {
    return (
      other.color === this.color &&
      other.from === this.from &&
      other.to === this.to &&
      other.canPick === this.canPick
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-color-swatch';
    wrap.style.backgroundColor = this.color;
    wrap.title = this.color;
    if (!this.canPick) return wrap;

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'cm-color-swatch-input';
    input.value = toHex6(this.color);
    input.addEventListener('input', () => {
      wrap.style.backgroundColor = applyHex(this.color, input.value);
    });
    input.addEventListener('change', () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: applyHex(this.color, input.value) },
      });
    });
    wrap.appendChild(input);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Find every color literal in `text`, in order. Pure (no editor/DOM) so it's
 *  easy to test. */
export function detectColors(text: string): { value: string; index: number }[] {
  const out: { value: string; index: number }[] = [];
  COLOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLOR_RE.exec(text)) !== null) {
    out.push({ value: m[0], index: m.index });
  }
  return out;
}

/** Build the swatch decoration set for the whole document. */
function buildDecorations(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = doc.toString();
  for (const { value, index } of detectColors(text)) {
    builder.add(
      index,
      index,
      Decoration.widget({
        widget: new SwatchWidget(value, index, index + value.length, isHex(value)),
        side: -1,
      }),
    );
  }
  return builder.finish();
}

const colorSwatchField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state.doc),
  update: (deco, tr) => (tr.docChanged ? buildDecorations(tr.state.doc) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

export function colorSwatches(): Extension {
  return colorSwatchField;
}
