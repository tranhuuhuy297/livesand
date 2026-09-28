// Physical-mode UI styles: calibration wizard, depth stage with corner handles, form fields and keystone grid.
export const WIZARD_CSS = `
.lsp-wizard { width: min(1120px, 100%); display: flex; flex-direction: column; }
.lsp-wiz-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; padding: 26px 30px 18px; border-bottom: 1px solid var(--ls-line); }
.lsp-head-side { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.lsp-live-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--ls-live); }
.lsp-live-badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px rgba(63,214,164,.18); }
.lsp-live-badge[data-live="false"] { color: var(--ls-danger); }
.lsp-wizard-overlay.is-compact .lsp-live-badge { display: none; }
.lsp-steps { list-style: none; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
.lsp-step-pill { display: flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 5px; border-radius: 15px; font-size: 12.5px; font-weight: 600; color: var(--ls-muted); background: rgba(255,255,255,.035); border: 1px solid var(--ls-line); }
.lsp-step-num { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; background: rgba(255,255,255,.08); }
.lsp-step-pill.is-active { color: var(--ls-text); border-color: rgba(242,180,92,.55); background: rgba(242,180,92,.1); }
.lsp-step-pill.is-active .lsp-step-num { background: var(--ls-accent); color: #1d1305; }
.lsp-step-pill.is-done { color: #b9c6d6; }
.lsp-step-pill.is-done .lsp-step-num { background: rgba(63,214,164,.2); color: var(--ls-live); }
.lsp-wiz-body { padding: 24px 30px; min-height: 280px; }
.lsp-step-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, 1fr); gap: 30px; align-items: start; }
.lsp-stage-col { display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 0; }
.lsp-stage {
  position: relative; width: 100%; border-radius: 14px; background: #05070b; border: 1px solid var(--ls-line-strong);
  box-shadow: 0 16px 40px rgba(0,0,0,.45); user-select: none; -webkit-user-select: none; touch-action: none;
}
.lsp-stage--pick { cursor: crosshair; }
.lsp-preview-canvas { display: block; width: 100%; height: 100%; border-radius: 13px; }
.lsp-roi-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.lsp-roi-outline { fill: rgba(242,180,92,.13); stroke: #fff; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.lsp-roi-outline.is-invalid { stroke: var(--ls-danger); fill: rgba(255,107,107,.14); }
.lsp-roi-mesh { fill: none; stroke: rgba(255,255,255,.45); stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.lsp-handle {
  position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; padding: 0; border-radius: 50%;
  border: 2px solid #fff; background: var(--ls-c0); color: #0b0f14; font: 800 10px/1 system-ui, sans-serif;
  display: grid; place-items: center; cursor: grab; touch-action: none; z-index: 2;
  box-shadow: 0 0 0 4px rgba(0,0,0,.35), 0 4px 12px rgba(0,0,0,.5); transition: transform .12s;
}
.lsp-handle[hidden] { display: none; }
.lsp-handle:hover, .lsp-handle:focus-visible { transform: scale(1.15); outline: none; }
.lsp-handle:focus-visible { box-shadow: 0 0 0 4px rgba(242,180,92,.8), 0 4px 12px rgba(0,0,0,.5); }
.lsp-handle.is-dragging { cursor: grabbing; transform: scale(1.2); }
.lsp-handle--1 { background: var(--ls-c1); } .lsp-handle--2 { background: var(--ls-c2); } .lsp-handle--3 { background: var(--ls-c3); }
.lsp-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.lsp-lead { font-size: 15px; color: var(--ls-text); }
.lsp-tip { color: var(--ls-muted); font-size: 13px; }
.lsp-corner-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.lsp-corner-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--ls-line); color: var(--ls-muted); font-weight: 600; transition: all .15s; }
.lsp-corner-item.is-next { color: var(--ls-text); border-color: rgba(242,180,92,.6); background: rgba(242,180,92,.08); }
.lsp-corner-item.is-next::after { content: "click it now"; margin-left: auto; font-size: 11.5px; color: var(--ls-accent); font-weight: 700; }
.lsp-corner-item.is-done { color: var(--ls-text); }
.lsp-corner-item.is-done::after { content: "✓"; margin-left: auto; color: var(--ls-live); }
.lsp-corner-dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 9.5px; font-weight: 800; color: #0b0f14; background: var(--ls-c0); flex: none; }
.lsp-corner-dot--1 { background: var(--ls-c1); } .lsp-corner-dot--2 { background: var(--ls-c2); } .lsp-corner-dot--3 { background: var(--ls-c3); }
.lsp-legend { display: flex; align-items: center; gap: 10px; width: 100%; font-size: 12px; color: var(--ls-muted); font-variant-numeric: tabular-nums; }
.lsp-legend-bar { position: relative; flex: 1; height: 8px; border-radius: 4px; }
.lsp-legend-marker { position: absolute; top: 12px; transform: translateX(-50%); font-size: 11px; color: var(--ls-text); }
.lsp-legend-marker::before { content: ""; position: absolute; left: 50%; top: -14px; width: 2px; height: 12px; margin-left: -1px; background: #fff; border-radius: 1px; }
.lsp-legend:has(.lsp-legend-marker) { margin-bottom: 12px; }
.lsp-progress { height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
.lsp-progress-fill { height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, var(--ls-accent), var(--ls-live)); transition: width .15s; }
.lsp-result { font-size: 13px; color: var(--ls-muted); font-variant-numeric: tabular-nums; }
.lsp-result.is-ok { color: var(--ls-live); font-weight: 600; }
.lsp-field { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,.03); border: 1px solid var(--ls-line); }
.lsp-field-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lsp-field-label { font-weight: 600; font-size: 13.5px; }
.lsp-field-value { display: flex; align-items: center; gap: 6px; }
.lsp-field-unit { color: var(--ls-muted); font-size: 12.5px; }
.lsp-field-hint { color: var(--ls-muted); font-size: 12px; }
.lsp-number { width: 68px; height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--ls-line-strong); background: rgba(0,0,0,.3); color: var(--ls-text); font: 600 13px/1 system-ui, sans-serif; text-align: right; font-variant-numeric: tabular-nums; }
.lsp-number:focus { outline: 2px solid var(--ls-accent); outline-offset: 1px; }
.lsp-range { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 3px; margin: 4px 0; cursor: pointer; background: linear-gradient(90deg, var(--ls-accent) var(--fill, 50%), rgba(255,255,255,.12) var(--fill, 50%)); }
.lsp-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid var(--ls-accent-deep); box-shadow: 0 2px 6px rgba(0,0,0,.4); }
.lsp-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 3px solid var(--ls-accent-deep); }
.lsp-range:focus-visible { outline: 2px solid var(--ls-accent); outline-offset: 4px; }
.lsp-derived { font-size: 13px; color: #cfe3ff; font-variant-numeric: tabular-nums; }
.lsp-phys .lsp-summary { display: grid; grid-template-columns: 150px 1fr; gap: 10px 18px; padding: 18px 20px; border-radius: 14px; background: rgba(255,255,255,.03); border: 1px solid var(--ls-line); margin-bottom: 14px; }
.lsp-summary dt { color: var(--ls-muted); }
.lsp-summary dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.lsp-notice { margin: 0 30px 14px; padding: 10px 14px; border-radius: 10px; font-size: 13px; border: 1px solid rgba(90,168,255,.35); background: rgba(90,168,255,.1); color: #cfe3ff; }
.lsp-notice[hidden] { display: none; }
.lsp-notice[data-tone="warn"] { border-color: rgba(245,196,81,.45); background: rgba(245,196,81,.1); color: #fbe3a6; }
.lsp-notice[data-tone="error"] { border-color: rgba(255,107,107,.5); background: rgba(255,107,107,.12); color: #ffc9c9; }
.lsp-wiz-foot { display: flex; align-items: center; gap: 10px; padding: 16px 30px; border-top: 1px solid var(--ls-line); }
.lsp-wizard-overlay.is-compact { background: none; backdrop-filter: none; -webkit-backdrop-filter: none; pointer-events: none; align-items: end; }
.lsp-wizard-overlay.is-compact .lsp-card { pointer-events: auto; width: min(600px, 100%); background: rgba(14,19,27,.94); }
.lsp-wizard-overlay.is-compact .lsp-steps { display: none; }
.lsp-wizard-overlay.is-compact .lsp-wiz-head { padding: 16px 22px 12px; }
.lsp-wizard-overlay.is-compact .lsp-wiz-body { min-height: 0; padding: 14px 22px; display: flex; flex-direction: column; gap: 10px; }
.lsp-wizard-overlay.is-compact .lsp-wiz-foot { padding: 12px 22px; }
.lsp-keystone-layer { position: fixed; inset: 0; z-index: 999; pointer-events: none; }
.lsp-keystone-layer .lsp-handle { pointer-events: auto; width: 38px; height: 38px; margin: -19px 0 0 -19px; font-size: 11px; }
.lsp-keystone-grid {
  position: fixed; transform-origin: 0 0; outline: 3px solid #fff; outline-offset: -3px; overflow: hidden;
  background-color: rgba(4,7,12,.78);
  background-image: linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px);
  background-size: 10% 10%;
}
.lsp-kgrid-corner { position: absolute; width: 14%; height: 18%; display: flex; padding: 10px 12px; font: 800 16px/1 system-ui, sans-serif; color: #0b0f14; }
.lsp-kgrid-corner--0 { left: 0; top: 0; background: linear-gradient(135deg, var(--ls-c0) 50%, transparent 50%); }
.lsp-kgrid-corner--1 { right: 0; top: 0; justify-content: flex-end; background: linear-gradient(225deg, var(--ls-c1) 50%, transparent 50%); }
.lsp-kgrid-corner--2 { right: 0; bottom: 0; justify-content: flex-end; align-items: flex-end; background: linear-gradient(315deg, var(--ls-c2) 50%, transparent 50%); }
.lsp-kgrid-corner--3 { left: 0; bottom: 0; align-items: flex-end; background: linear-gradient(45deg, var(--ls-c3) 50%, transparent 50%); }
.lsp-kgrid-top { position: absolute; left: 50%; top: 4%; transform: translateX(-50%); padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.92); color: #0b0f14; font: 800 13px/1 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.lsp-kgrid-cross { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%; border: 3px solid var(--ls-accent); }
.lsp-kgrid-cross::before, .lsp-kgrid-cross::after { content: ""; position: absolute; background: var(--ls-accent); }
.lsp-kgrid-cross::before { left: 50%; top: -18px; bottom: -18px; width: 3px; margin-left: -1.5px; }
.lsp-kgrid-cross::after { top: 50%; left: -18px; right: -18px; height: 3px; margin-top: -1.5px; }
@media (max-width: 860px) { .lsp-step-grid { grid-template-columns: 1fr; } }
`;
