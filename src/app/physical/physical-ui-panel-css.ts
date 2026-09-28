// Physical-mode UI styles: design tokens, overlays, cards, buttons and the pairing panel.
export const PANEL_CSS = `
.ls-phys {
  --ls-text: #e9eef4; --ls-muted: #8f9cb0; --ls-line: rgba(255,255,255,.09); --ls-line-strong: rgba(255,255,255,.16);
  --ls-accent: #f2b45c; --ls-accent-deep: #e0983a; --ls-live: #3fd6a4; --ls-warn: #f5c451; --ls-danger: #ff6b6b;
  --ls-c0: #ff5d6c; --ls-c1: #45dd8e; --ls-c2: #5aa8ff; --ls-c3: #ffd23f;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  color: var(--ls-text); -webkit-font-smoothing: antialiased;
}
.ls-phys *, .ls-phys *::before, .ls-phys *::after { box-sizing: border-box; }
.ls-phys h2, .ls-phys h3, .ls-phys p, .ls-phys ol, .ls-phys dl { margin: 0; }
.ls-phys code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.ls-overlay {
  position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; overflow: auto; pointer-events: auto;
  background: radial-gradient(1200px 700px at 50% -10%, rgba(56,78,110,.55), rgba(6,9,14,.94) 60%);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  animation: ls-fade .25s ease-out;
}
@keyframes ls-fade { from { opacity: 0; } }
@keyframes ls-rise { from { opacity: 0; transform: translateY(10px); } }
.ls-card {
  width: min(940px, 100%); border-radius: 22px; border: 1px solid var(--ls-line);
  background: linear-gradient(180deg, rgba(25,33,45,.97), rgba(14,19,27,.98));
  box-shadow: 0 40px 100px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.05);
  animation: ls-rise .3s ease-out;
}
.ls-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ls-accent); }
.ls-title { font-size: 24px; font-weight: 700; letter-spacing: -.01em; margin-top: 4px; }
.ls-sub { color: var(--ls-muted); margin-top: 6px; max-width: 640px; }
.ls-muted { color: var(--ls-muted); }
.ls-ok { color: var(--ls-live); }
.ls-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; padding: 0 16px;
  border-radius: 10px; border: 1px solid var(--ls-line-strong); background: rgba(255,255,255,.05); color: var(--ls-text);
  font-family: inherit; font-weight: 600; font-size: 13.5px; line-height: 1; cursor: pointer; transition: background .15s, border-color .15s, transform .1s;
}
.ls-btn:hover:not(:disabled) { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.26); }
.ls-btn:active:not(:disabled) { transform: translateY(1px); }
.ls-btn:focus-visible { outline: 2px solid var(--ls-accent); outline-offset: 2px; }
.ls-btn:disabled { opacity: .42; cursor: not-allowed; }
.ls-btn--primary { border: none; color: #1d1305; background: linear-gradient(180deg, #f7c677, var(--ls-accent-deep)); box-shadow: 0 6px 18px rgba(240,160,60,.25); }
.ls-btn--primary:hover:not(:disabled) { background: linear-gradient(180deg, #fbd08a, #e9a345); }
.ls-btn--ghost { background: transparent; }
.ls-btn--small { height: 30px; padding: 0 12px; font-size: 12.5px; }
.ls-btn--wide { width: 100%; height: 44px; font-size: 14.5px; }
.ls-btn.is-done { color: var(--ls-live); border-color: rgba(63,214,164,.5); }
.ls-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ls-spacer { flex: 1; }

.ls-pair-head { padding: 30px 34px 0; }
.ls-pair-grid { display: grid; grid-template-columns: 272px 1fr; gap: 34px; padding: 26px 34px 8px; }
.ls-pair-qr-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ls-qr {
  position: relative; width: 272px; height: 272px; border-radius: 18px; background: #fff; padding: 14px;
  display: grid; place-items: center; box-shadow: 0 0 0 6px rgba(242,180,92,.14), 0 18px 40px rgba(0,0,0,.4);
}
.ls-qr-img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.ls-qr.is-loading .ls-qr-img { visibility: hidden; }
.ls-spinner { display: none; position: absolute; width: 34px; height: 34px; border-radius: 50%; border: 3px solid #d9dee6; border-top-color: var(--ls-accent-deep); animation: ls-spin 1s linear infinite; }
.ls-qr.is-loading .ls-spinner { display: block; }
@keyframes ls-spin { to { transform: rotate(360deg); } }
.ls-url-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ls-url, .ls-cmd {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 8px 10px;
  border-radius: 9px; background: rgba(0,0,0,.35); border: 1px solid var(--ls-line); color: #cfe3ff; user-select: all;
}
.ls-url { white-space: normal; word-break: break-all; text-overflow: clip; font-size: 12px; }
.ls-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ls-chips:empty { display: none; }
.ls-chip { height: 26px; padding: 0 10px; border-radius: 13px; border: 1px solid var(--ls-line-strong); background: transparent; color: var(--ls-muted); font-family: inherit; font-weight: 600; font-size: 12px; line-height: 1; cursor: pointer; }
.ls-chip.is-active { color: #1d1305; background: var(--ls-accent); border-color: transparent; }
.ls-pair-steps { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 20px; }
.ls-pair-step { display: grid; grid-template-columns: 32px 1fr; gap: 14px; }
.ls-pair-step h3 { font-size: 15px; font-weight: 700; margin-bottom: 3px; }
.ls-pair-step p { color: #c3ccd8; }
.ls-pair-step p + p { margin-top: 2px; }
.ls-pair-step p.ls-ok { color: var(--ls-live); font-weight: 600; }
.ls-step-badge {
  width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 14px;
  color: var(--ls-accent); background: rgba(242,180,92,.12); border: 1px solid rgba(242,180,92,.35);
}
.ls-relay-note { color: var(--ls-warn) !important; font-size: 12.5px; margin-top: 6px !important; }
.ls-relay-note:empty { display: none; }
.ls-pair-alt { margin: 18px 34px 0; padding: 16px 18px; border-radius: 14px; background: rgba(255,255,255,.03); border: 1px dashed var(--ls-line-strong); }
.ls-alt-title { color: var(--ls-muted); font-size: 13px; margin-bottom: 8px !important; }
.ls-pair-status { display: flex; align-items: center; gap: 10px; margin-top: 22px; padding: 14px 34px; border-top: 1px solid var(--ls-line); color: #c3ccd8; font-size: 13px; }
.ls-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ls-danger); box-shadow: 0 0 0 0 currentColor; flex: none; }
.ls-dot[data-state="off"] { color: rgba(255,107,107,.55); background: var(--ls-danger); animation: ls-pulse 1.6s infinite; }
.ls-dot[data-state="wait"] { color: rgba(245,196,81,.55); background: var(--ls-warn); animation: ls-pulse 1.6s infinite; }
.ls-dot[data-state="live"] { background: var(--ls-live); }
@keyframes ls-pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 100% { box-shadow: 0 0 0 9px transparent; } }
@media (max-width: 760px) {
  .ls-pair-grid { grid-template-columns: 1fr; }
  .ls-qr { margin: 0 auto; }
}
`;
