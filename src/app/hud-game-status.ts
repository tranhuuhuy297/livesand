// Game status widgets: countdown pill, storm meter and one status chip per village.
import type { VillageState } from '../core/types';
import { formatClock, h, setHidden, setText, toggleClass } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { peakStormRain, type HudSnapshot } from './hud-snapshot';

const icon = (svg: string): HTMLElement => h('span', { class: 'ls-icon', html: svg, attrs: { 'aria-hidden': 'true' } });

function meter(): { root: HTMLElement; fill: HTMLElement } {
  const fill = h('div', { class: 'ls-meter-fill' });
  return { root: h('div', { class: 'ls-meter', attrs: { 'aria-hidden': 'true' } }, [fill]), fill };
}

function setFill(fill: HTMLElement, fraction: number): void {
  const pct = `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`;
  if (fill.style.width !== pct) fill.style.width = pct;
}

export class GameStatusBar {
  readonly root: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly timerText = h('span', { class: 'ls-timer-text', attrs: { 'aria-live': 'off' } });
  private readonly timerMeter = meter();
  private readonly storm: HTMLDivElement;
  private readonly stormMeter = meter();

  constructor() {
    this.timer = h('div', { class: 'ls-pill ls-timer ls-glass', title: 'Time left to keep the villages dry' }, [
      icon(ICONS.clock),
      this.timerText,
      this.timerMeter.root,
    ]);
    this.storm = h('div', { class: 'ls-pill ls-storm ls-glass', title: 'Storm intensity' }, [
      icon(ICONS.storm),
      h('span', { class: 'ls-pill-label', text: 'Storm' }),
      this.stormMeter.root,
    ]);
    this.root = h('div', { class: 'ls-status' }, [this.timer, this.storm]);
  }

  update(s: HudSnapshot): void {
    const free = s.level.villages.length === 0 || !Number.isFinite(s.level.durationSec);
    toggleClass(this.timer, 'is-free', free);
    setHidden(this.timerMeter.root, free);
    if (free) {
      setText(this.timerText, 'Free play');
    } else {
      const left = Math.max(0, s.level.durationSec - s.elapsedSec);
      setText(this.timerText, formatClock(left));
      setFill(this.timerMeter.fill, left / s.level.durationSec);
      toggleClass(this.timer, 'is-paused', s.phase === 'ready');
      toggleClass(this.timer, 'is-urgent', s.phase === 'running' && left <= 10);
    }
    const peak = peakStormRain(s.level);
    setHidden(this.storm, peak <= 0);
    if (peak > 0) {
      setFill(this.stormMeter.fill, s.rainRate / peak);
      toggleClass(this.storm, 'is-raining', s.rainRate > peak * 0.05);
    }
  }
}

const STATE_TEXT: Record<VillageState, string> = { safe: 'Dry', flooding: 'Flooding', lost: 'Lost' };

interface Chip {
  root: HTMLElement;
  status: HTMLElement;
  fill: HTMLElement;
}

export class VillageChips {
  readonly root: HTMLElement;
  private chips: Chip[] = [];
  private levelId = '';

  constructor() {
    this.root = h('aside', { class: 'ls-villages', attrs: { 'aria-label': 'Villages' } });
  }

  update(s: HudSnapshot): void {
    if (this.levelId !== s.level.id || this.chips.length !== s.villages.length) {
      this.levelId = s.level.id;
      this.chips = s.villages.map((v) => {
        const status = h('span', { class: 'ls-village-status' });
        const bar = meter();
        const root = h('div', { class: 'ls-village ls-glass' }, [
          h('span', { class: 'ls-village-icon', html: ICONS.house, attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'ls-village-text' }, [h('span', { class: 'ls-village-name', text: v.spec.name }), status]),
          bar.root,
        ]);
        return { root, status, fill: bar.fill };
      });
      this.root.replaceChildren(...this.chips.map((c) => c.root));
    }
    setHidden(this.root, this.chips.length === 0);
    s.villages.forEach((v, i) => {
      const chip = this.chips[i];
      const flood = s.markers[i]?.flood01 ?? 0;
      for (const state of ['safe', 'flooding', 'lost'] as const) toggleClass(chip.root, `is-${state}`, v.state === state);
      const text = v.state === 'flooding' ? `${STATE_TEXT.flooding} ${Math.round(flood * 100)}%` : STATE_TEXT[v.state];
      setText(chip.status, text);
      setFill(chip.fill, flood);
    });
  }
}
