// Game status widgets: countdown pill, storm and eruption meters, and one status chip per village.
import type { VillageState } from '../core/types';
import { peakEruptionRate, peakStormRain } from '../game/level-definitions';
import { formatClock, h, setHidden, setText, toggleClass } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { HudSnapshot } from './hud-snapshot';

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
  private readonly eruption: HTMLDivElement;
  private readonly eruptionMeter = meter();

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
    this.eruption = h('div', { class: 'ls-pill ls-eruption ls-glass', title: 'Eruption strength' }, [
      icon(ICONS.volcano),
      h('span', { class: 'ls-pill-label', text: 'Eruption' }),
      this.eruptionMeter.root,
    ]);
    this.root = h('div', { class: 'ls-status' }, [this.timer, this.storm, this.eruption]);
  }

  update(s: HudSnapshot): void {
    // Free play has no clock: the picker already says "Free play" and its own actions take this spot.
    const free = s.level.villages.length === 0 || !Number.isFinite(s.level.durationSec);
    setHidden(this.timer, free);
    const left = free ? 0 : Math.max(0, s.level.durationSec - s.elapsedSec);
    // Both flags are recomputed every frame so a level switch can never leave a stale grey or red pill behind.
    toggleClass(this.timer, 'is-paused', !free && (s.phase === 'ready' || (s.paused && s.phase === 'running')));
    toggleClass(this.timer, 'is-urgent', !free && !s.paused && s.phase === 'running' && left <= 10);
    if (!free) {
      setText(this.timerText, formatClock(left));
      setFill(this.timerMeter.fill, left / s.level.durationSec);
    }
    const peak = peakStormRain(s.level);
    setHidden(this.storm, peak <= 0);
    if (peak > 0) {
      setFill(this.stormMeter.fill, s.rainRate / peak);
      toggleClass(this.storm, 'is-raining', s.rainRate > peak * 0.05);
    }
    const lavaPeak = peakEruptionRate(s.level);
    setHidden(this.eruption, lavaPeak <= 0);
    if (lavaPeak > 0) {
      const erupting = s.phase === 'running' ? s.eruptionRate : 0;
      setFill(this.eruptionMeter.fill, erupting / lavaPeak);
      toggleClass(this.eruption, 'is-erupting', erupting > lavaPeak * 0.5);
    }
  }
}

const STATE_TEXT: Record<VillageState, string> = { safe: 'Dry', flooding: 'Flooding', burning: 'Burning', lost: 'Lost' };
const STATES: readonly VillageState[] = ['safe', 'flooding', 'burning', 'lost'];

interface Chip {
  root: HTMLElement;
  status: HTMLElement;
  fill: HTMLElement;
}

export class VillageChips {
  readonly root: HTMLElement;
  private chips: Chip[] = [];
  // Compared by object: every live place's storm shares one id but names its own town.
  private level: HudSnapshot['level'] | null = null;

  constructor() {
    this.root = h('aside', { class: 'ls-villages', attrs: { 'aria-label': 'Villages' } });
  }

  update(s: HudSnapshot): void {
    if (this.level !== s.level || this.chips.length !== s.villages.length) {
      this.level = s.level;
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
      for (const state of STATES) toggleClass(chip.root, `is-${state}`, v.state === state);
      const damaged = v.state === 'flooding' || v.state === 'burning';
      const lavaNear = v.state === 'safe' && Boolean(s.lavaNear[i]);
      toggleClass(chip.root, 'is-lava-near', lavaNear);
      let text = damaged ? `${STATE_TEXT[v.state]} ${Math.round(flood * 100)}%` : STATE_TEXT[v.state];
      if (v.state === 'lost' && v.lostTo === 'lava') text = 'Burned';
      else if (lavaNear) text = 'Lava close';
      else if (v.state === 'safe' && s.level.eruption) text = 'Safe';
      setText(chip.status, text);
      setFill(chip.fill, flood);
    });
  }
}
