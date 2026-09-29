// Help overlay (controls + how to play) and the "Real sandbox" dialog explaining the physical setup.
import { h } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { HudModal } from './hud-modal';
import { REAL_SANDBOX_ILLUSTRATION } from './real-sandbox-illustration';

export const PROJECT_REPO_URL = 'https://github.com/tranhuuhuy297/livesand';

const kbd = (...keys: string[]): HTMLElement =>
  h('span', { class: 'ls-keys' }, keys.flatMap((k, i) => [i > 0 ? ' ' : null, h('kbd', { text: k })]));

const row = (keys: HTMLElement, text: string): HTMLElement => h('div', { class: 'ls-help-row' }, [keys, h('span', { text })]);

export function createHelpDialog(onRealSandbox: () => void): HudModal {
  const modal = new HudModal('ls-help', 'Controls and how to play');
  const real = h('button', { class: 'ls-btn ls-btn-secondary', attrs: { type: 'button' } }, [
    h('span', { class: 'ls-icon', html: ICONS.projector, attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ls-btn-label', text: 'Play it on real sand' }),
  ]);
  real.addEventListener('click', () => {
    modal.close();
    onRealSandbox();
  });
  modal.body.append(
    h('h2', { class: 'ls-modal-title', text: 'How to play' }),
    h('p', {
      class: 'ls-modal-lead',
      text:
        'Water flows downhill. Keep every village dry until the clock runs out: dig channels that carry water to the ' +
        'open edge (the sea), pile up levees, or raise the ground under a village. Lava flows slowly and turns to ' +
        'rock: steer it with walls and trenches.',
    }),
    h('div', { class: 'ls-help-grid' }, [
      h('section', {}, [
        h('h3', { text: 'Mouse' }),
        row(kbd('Left drag'), 'Use the active tool'),
        row(kbd('Right drag'), 'Orbit the camera (3D)'),
        row(kbd('Space', 'drag'), 'Orbit with a trackpad'),
        row(kbd('Wheel'), 'Zoom (3D)'),
        row(kbd('Alt', 'wheel'), 'Brush size'),
        h('h3', { text: 'Touch' }),
        row(kbd('1 finger'), 'Use the active tool'),
        row(kbd('2 fingers'), 'Orbit and pinch to zoom'),
      ]),
      h('section', {}, [
        h('h3', { text: 'Keyboard' }),
        row(kbd('1', '2', '3', '4', '5'), 'Raise, Dig, Smooth, Flatten, Rain'),
        row(kbd('6'), 'Lava (free play, Mount Ember)'),
        row(kbd('[', ']'), 'Smaller / bigger brush'),
        row(kbd('V'), 'Switch 2D map / 3D view'),
        row(kbd('Enter'), 'Start the level'),
        row(kbd('R'), 'Restart the level'),
        row(kbd('F'), 'Fullscreen'),
        row(kbd('H'), 'Show or hide this help'),
      ]),
    ]),
    h('div', { class: 'ls-modal-actions ls-help-actions' }, [real]),
  );
  return modal;
}

export function createRealSandboxDialog(onOpenProjector: () => void): HudModal {
  const modal = new HudModal('ls-real', 'Build a real AR sandbox');
  const steps = [
    ['Mount the hardware', 'A LiDAR iPhone or iPad (12 Pro or newer) and a projector above a sandbox, both looking straight down.'],
    ['Start the relay', 'On a laptop on the same Wi-Fi run npx livesand. It serves this app and prints the projector URL.'],
    ['Open projector mode', 'Open that URL on the laptop, drag the window onto the projector and go fullscreen (F).'],
    ['Pair the phone', 'Open the LiveSand Depth app on the iPhone and scan the QR code shown by the projector.'],
    ['Calibrate', 'Mark the sandbox corners, capture the flat sand, then corner-pin the image onto the box.'],
  ];
  const openProjector = h('button', { class: 'ls-btn ls-btn-primary', attrs: { type: 'button' } }, [
    h('span', { class: 'ls-icon', html: ICONS.projector, attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ls-btn-label', text: 'Open projector mode' }),
  ]);
  openProjector.addEventListener('click', onOpenProjector);
  const guide = h('a', {
    class: 'ls-btn ls-btn-secondary',
    attrs: { href: `${PROJECT_REPO_URL}#readme`, target: '_blank', rel: 'noopener noreferrer' },
  }, [h('span', { class: 'ls-icon', html: ICONS.book, attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'ls-btn-label', text: 'Setup guide' })]);

  modal.body.append(
    h('div', { class: 'ls-real-illustration', html: REAL_SANDBOX_ILLUSTRATION }),
    h('h2', { class: 'ls-modal-title', text: 'Play it on real sand' }),
    h('p', {
      class: 'ls-modal-lead',
      text:
        'LiveSand is an AR sandbox: an iPhone LiDAR scans the sand, the projector paints this simulation back onto it, ' +
        'and holding your hand over the box makes it rain.',
    }),
    h('ol', { class: 'ls-steps' }, steps.map(([title, text]) => h('li', {}, [h('strong', { text: title }), h('span', { text })]))),
    h('p', { class: 'ls-modal-note', text: 'Projector mode talks to the phone through the local relay, so open it from npx livesand, not the hosted demo.' }),
    h('div', { class: 'ls-modal-actions' }, [guide, openProjector]),
  );
  return modal;
}
