// Inline SVG of the physical setup (projector + iPhone above a sandbox, a hand making rain) for the "Real sandbox" dialog.

/** Static trusted markup; drawn in a 320 x 150 box. */
export const REAL_SANDBOX_ILLUSTRATION = `
<svg viewBox="0 0 320 150" role="img" aria-label="A projector and an iPhone look down at a sandbox; a hand held over the sand makes it rain" focusable="false">
  <defs>
    <linearGradient id="ls-ill-sand" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#1d6fb8"/><stop offset="0.22" stop-color="#38bdf8"/><stop offset="0.36" stop-color="#34a853"/>
      <stop offset="0.58" stop-color="#e9d27a"/><stop offset="0.78" stop-color="#c8743c"/><stop offset="1" stop-color="#8f5b3a"/>
    </linearGradient>
    <linearGradient id="ls-ill-beam" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#fde68a" stop-opacity="0.35"/><stop offset="1" stop-color="#fde68a" stop-opacity="0.06"/>
    </linearGradient>
  </defs>
  <path d="M40 10h240" stroke="#64748b" stroke-width="3" stroke-linecap="round"/>
  <path d="M148 34L34 104h252L160 34z" fill="url(#ls-ill-beam)"/>
  <path d="M190 36L40 104M190 36L280 104" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.7"/>
  <rect x="126" y="13" width="44" height="21" rx="5" fill="#cbd5e1"/>
  <circle cx="154" cy="27" r="5.5" fill="#0f172a"/><circle cx="154" cy="27" r="2.2" fill="#fde68a"/>
  <rect x="183" y="12" width="14" height="25" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="1.2"/>
  <circle cx="190" cy="31" r="2" fill="#38bdf8"/>
  <path d="M30 104c30-10 52 4 80-4s40-18 70-12 40 14 64 6 30-6 46 2v16H30z" fill="url(#ls-ill-sand)"/>
  <path d="M60 104c18-4 30 2 46-2M150 92c18-3 34 4 52 6M232 98c14-4 26-4 40 0" stroke="#0f172a" stroke-opacity="0.35" fill="none"/>
  <rect x="24" y="112" width="272" height="26" rx="4" fill="#a57a4d"/>
  <path d="M24 120h272M24 129h272" stroke="#8a6340" stroke-width="1.5"/>
  <path d="M238 54c0-6 4-8 7-8s5 3 5 6v-9c0-4 5-4 5 0v8-11c0-4 5-4 5 0v11-9c0-4 5-4 5 0v12-6c0-4 5-4 5 0v12c0 9-6 15-15 15h-3c-8 0-14-7-14-15z" fill="#f2c9a0" stroke="#c9936a" stroke-width="1"/>
  <path d="M244 82l-2 7M253 84l-2 7M262 82l-2 7M249 94l-2 6M258 95l-2 6" stroke="#67d4ff" stroke-width="2" stroke-linecap="round"/>
</svg>`;
