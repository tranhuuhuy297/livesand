// Bottom dock: sculpt/rain tool buttons with key hints and the brush size slider.
import type { SculptTool } from '../input/sculpt-tools';
import { h, setText } from './hud-dom-helpers';
import { BRUSH_RADIUS_MAX, BRUSH_RADIUS_MIN, TOOLS } from './sculpt-tool-settings';
import type { HudActions, HudSnapshot } from './hud-snapshot';

export class ToolDock {
  readonly root: HTMLDivElement;
  private readonly buttons = new Map<SculptTool, HTMLButtonElement>();
  private readonly slider: HTMLInputElement;
  private readonly sizeText = h('span', { class: 'ls-brush-value' });
  private tool: SculptTool | null = null;
  private radius = -1;

  constructor(actions: HudActions) {
    const tools = h('div', { class: 'ls-tools', attrs: { role: 'toolbar', 'aria-label': 'Tools' } }, TOOLS.map((t) => {
      const btn = h('button', {
        class: `ls-tool tool-${t.id}`,
        title: `${t.label} (${t.key}): ${t.hint}`,
        attrs: { type: 'button', 'aria-pressed': 'false', 'data-tool': t.id },
      }, [
        h('span', { class: 'ls-icon', html: t.icon, attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'ls-tool-label', text: t.label }),
        h('kbd', { class: 'ls-tool-key', text: t.key }),
      ]);
      btn.addEventListener('click', (ev) => {
        if (ev.detail > 0) btn.blur();
        actions.setTool(t.id);
      });
      this.buttons.set(t.id, btn);
      return btn;
    }));

    this.slider = h('input', {
      class: 'ls-range',
      title: 'Brush size ([ and ])',
      attrs: { type: 'range', min: String(BRUSH_RADIUS_MIN), max: String(BRUSH_RADIUS_MAX), step: '1', 'aria-label': 'Brush size' },
    });
    this.slider.addEventListener('input', () => actions.setBrushRadius(Number(this.slider.value)));
    // A mouse/touch drag releases focus so Space and the digit keys go back to the sandbox; keyboard users keep it.
    let dragging = false;
    this.slider.addEventListener('pointerdown', () => {
      dragging = true;
    });
    window.addEventListener('pointerup', () => {
      if (dragging) this.slider.blur();
      dragging = false;
    });

    const brush = h('label', { class: 'ls-brush' }, [
      h('span', { class: 'ls-brush-title', text: 'Brush' }),
      this.slider,
      this.sizeText,
    ]);
    this.root = h('div', { class: 'ls-dock ls-glass' }, [tools, h('div', { class: 'ls-divider', attrs: { 'aria-hidden': 'true' } }), brush]);
  }

  update(s: HudSnapshot): void {
    if (this.tool !== s.tool) {
      this.tool = s.tool;
      for (const [id, btn] of this.buttons) {
        const on = id === s.tool;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', String(on));
      }
    }
    if (this.radius !== s.brushRadius) {
      this.radius = s.brushRadius;
      if (document.activeElement !== this.slider) this.slider.value = String(s.brushRadius);
      setText(this.sizeText, String(s.brushRadius));
      const pct = ((s.brushRadius - BRUSH_RADIUS_MIN) / (BRUSH_RADIUS_MAX - BRUSH_RADIUS_MIN)) * 100;
      this.slider.style.setProperty('--fill', `${pct.toFixed(1)}%`);
    }
  }
}
