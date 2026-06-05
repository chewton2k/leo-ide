import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { detectColors, colorSwatches } from '../../../src/lib/modules/editor/colorSwatches';

// Note: the swatch *rendering* is a CodeMirror ViewPlugin widget, which jsdom
// can't materialize (no measure/render cycle), so we test the pure color
// detection here. The widget wiring uses the standard CodeMirror decoration
// pattern and is verified visually in the app.
describe('detectColors', () => {
  it('finds hex, rgb, and hsl literals in order', () => {
    const colors = detectColors('"--bg": "#1a1b26", rgb(255,0,0), hsl(200,50%,40%)');
    expect(colors.map(c => c.value)).toEqual(['#1a1b26', 'rgb(255,0,0)', 'hsl(200,50%,40%)']);
  });

  it('handles 3/4/6/8-digit hex', () => {
    expect(detectColors('#fff #abcd #00ff00 #12345678').map(c => c.value))
      .toEqual(['#fff', '#abcd', '#00ff00', '#12345678']);
  });

  it('reports correct indices', () => {
    const colors = detectColors('xx #ff0000');
    expect(colors).toEqual([{ value: '#ff0000', index: 3 }]);
  });

  it('finds nothing when there are no colors', () => {
    expect(detectColors('{ "name": "no colors here" }')).toEqual([]);
  });
});

// Regression: the swatch widget is constructed during state creation for any
// document containing a color. A field named to collide with a getter on
// CodeMirror's WidgetType base class (e.g. `editable`) throws
// "Cannot set property ... which has only a getter" — which broke loading
// color-heavy files like HTML/CSS. Build state to exercise widget construction.
describe('colorSwatches state field', () => {
  it('builds editor state for color-heavy content without throwing', () => {
    const doc = 'body { background: #1a1b26; color: rgb(255,255,255); }\n#x { border: 1px solid rgba(0,0,0,0.5) }';
    expect(() => EditorState.create({ doc, extensions: [colorSwatches()] })).not.toThrow();
  });

  it('builds editor state when there are no colors', () => {
    expect(() => EditorState.create({ doc: 'plain text', extensions: [colorSwatches()] })).not.toThrow();
  });
});
