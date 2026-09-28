// Labelled slider + number input pair used by the relief step.
import { el } from './dom-builder';

export interface RangeFieldOptions {
  label: string;
  hint?: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  testId: string;
  onInput(value: number): void;
}

export interface RangeField {
  root: HTMLElement;
  setValue(value: number): void;
}

export function rangeField(opts: RangeFieldOptions): RangeField {
  const attrs = { min: String(opts.min), max: String(opts.max), step: String(opts.step) };
  const slider = el('input', { className: 'lsp-range', attrs: { type: 'range', ...attrs, 'aria-label': opts.label, 'data-testid': `${opts.testId}-range` } });
  const box = el('input', { className: 'lsp-number', attrs: { type: 'number', ...attrs, 'aria-label': `${opts.label} (${opts.unit})`, 'data-testid': opts.testId } });
  const setValue = (v: number): void => {
    slider.value = String(v);
    box.value = String(v);
    const pct = ((v - opts.min) / (opts.max - opts.min)) * 100;
    slider.style.setProperty('--fill', `${Math.min(100, Math.max(0, pct))}%`);
  };
  const commit = (raw: string, fromBox: boolean): void => {
    const v = Number(raw);
    // Half-typed numbers must not snap the field while the user is still typing.
    if (!Number.isFinite(v) || raw.trim() === '') return;
    const clamped = Math.min(opts.max, Math.max(opts.min, v));
    if (fromBox && clamped !== v) return;
    setValue(clamped);
    opts.onInput(clamped);
  };
  slider.addEventListener('input', () => commit(slider.value, false));
  box.addEventListener('input', () => commit(box.value, true));
  box.addEventListener('change', () => {
    const v = Number(box.value);
    const clamped = Number.isFinite(v) ? Math.min(opts.max, Math.max(opts.min, v)) : opts.value;
    setValue(clamped);
    opts.onInput(clamped);
  });
  setValue(opts.value);
  const root = el('label', 'lsp-field', [
    el('span', 'lsp-field-head', [
      el('span', { className: 'lsp-field-label', text: opts.label }),
      el('span', 'lsp-field-value', [box, el('span', { className: 'lsp-field-unit', text: opts.unit })]),
    ]),
    slider,
    opts.hint ? el('span', { className: 'lsp-field-hint', text: opts.hint }) : null,
  ]);
  return { root, setValue };
}
