// Inline SVG icons (stroke = currentColor) so the HUD ships without an icon font or image requests.

const svg = (body: string, filled = false): string =>
  `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" ` +
  `stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;

export const ICONS = {
  logo:
    `<svg viewBox="0 0 32 32" focusable="false"><rect width="32" height="32" rx="8" fill="#101a24"/>` +
    `<path d="M3 22c5-8 9-12 13.5-12S24 14 29 20v7H3z" fill="#e8b75c"/>` +
    `<path d="M3 23c4-2 7-2 10 0s6 2 10 0 5-2 6-1v8H3z" fill="#38bdf8"/></svg>`,
  raise: svg('<path d="M3 20l6-9 4 5 3-3 5 7z"/><path d="M17 9V3M14 6l3-3 3 3"/>'),
  lower: svg('<path d="M3 7l5 9h8l5-9"/><path d="M12 3v8M9 8l3 3 3-3"/><path d="M3 20h18"/>'),
  smooth: svg('<path d="M3 11c3-4 6-4 9 0s6 4 9 0"/><path d="M3 17c3-2 6-2 9 0s6 2 9 0" opacity=".55"/>'),
  flatten: svg('<path d="M3 19h18"/><path d="M6 15l2.5-5h7L18 15z"/><path d="M12 10V4"/>'),
  rain: svg('<path d="M7 14a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 6.5 3.8 3.8 0 0 1 17 14z"/><path d="M8 17.5l-1 2.5M12.5 17.5l-1 2.5M17 17.5l-1 2.5"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  storm: svg('<path d="M7 13a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 5.5 3.8 3.8 0 0 1 17 13"/><path d="M12.5 11l-2.5 4.5h4L11.5 20"/>'),
  help: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.1-2.5 3.7"/><path d="M12 16.8h.01"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  map: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>', true),
  retry: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4.5H9"/>'),
  next: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  star: svg('<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', true),
  house: svg('<path d="M4 11l8-6.5 8 6.5v9H4z"/><path d="M10 20v-5h4v5"/>'),
  speed: svg('<path d="M4 6.5l7.5 5.5L4 17.5zM12.5 6.5l7.5 5.5-7.5 5.5z"/>'),
  projector: svg('<rect x="3" y="8" width="18" height="9" rx="2.5"/><circle cx="15.5" cy="12.5" r="2.5"/><path d="M6.5 11.5h3M6 17v2.5M18 17v2.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  book: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>'),
  chevron: svg('<path d="M6 9l6 6 6-6"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  exit: svg('<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  github:
    `<svg viewBox="0 0 24 24" fill="currentColor" focusable="false"><path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.8` +
    `c-2.92.63-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.07 1.61 1.08 1.61 1.08.94 1.6 2.46 1.14 3.06.87` +
    `.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.08 1.08-2.82-.1-.27-.47-1.34.1-2.78 0 0 .88-.28 2.89 1.08a10 10 0 0 1` +
    ` 5.26 0c2-1.36 2.88-1.08 2.88-1.08.58 1.44.21 2.51.1 2.78.68.74 1.08 1.67 1.08 2.82 0 4.03-2.45 4.91-4.79 5.17.38.33.72.97.72 1.96v2.9` +
    `c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5z"/></svg>`,
  shuffle: svg('<path d="M3 17l5-7 4 5 3-3 6 5"/><path d="M16 3h5v5M21 3l-6 6"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  volcano: svg('<path d="M3 20l6.5-10h5L21 20z"/><path d="M12 7.5V3.5M9.3 7.8L7.6 5M14.7 7.8L16.4 5"/><path d="M11 10l-1.2 4.2 1.8 1.8"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.2-3.6-8.5s1.1-6.1 3.6-8.5z"/>'),
  locate: svg('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'),
  share: svg('<path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M6 11.5H5v8.5h14v-8.5h-1"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  starOutline: svg('<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
} as const;

export type IconName = keyof typeof ICONS;
