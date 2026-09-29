// Level intro card: the briefing shown while a level waits in the ready phase.
import { peakEruptionRate, peakStormRain, type LevelDefinition } from '../game/level-definitions';
import { formatClock, h, iconButton, setHidden, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { HudActions, HudSnapshot } from './hud-snapshot';

export class LevelIntroCard {
  readonly root: HTMLDivElement;
  private readonly eyebrow = h('div', { class: 'ls-eyebrow' });
  private readonly title = h('h2', { class: 'ls-card-title' });
  private readonly tagline = h('p', { class: 'ls-card-text' });
  private readonly facts = h('div', { class: 'ls-facts' });
  private readonly nudge = h('span', { class: 'ls-muted' });
  // Compared by object: every live place's storm shares one id but has its own town and text.
  private shownFor: LevelDefinition | null = null;

  constructor(actions: HudActions) {
    const start = iconButton(ICONS.play, 'Start', () => actions.startLevel(), { class: 'ls-btn-primary ls-btn-lg', showLabel: true, kbd: 'Enter' });
    start.append(h('kbd', { class: 'ls-kbd-hint', text: 'Enter' }));
    this.root = h('div', { class: 'ls-intro ls-glass', attrs: { role: 'region', 'aria-label': 'Level briefing' } }, [
      h('div', { class: 'ls-intro-text' }, [this.eyebrow, this.title, this.tagline, this.facts]),
      h('div', { class: 'ls-intro-actions' }, [start, this.nudge]),
    ]);
    this.root.hidden = true;
  }

  update(s: HudSnapshot): void {
    const show = s.phase === 'ready' && s.level.villages.length > 0;
    setHidden(this.root, !show);
    if (!show || this.shownFor === s.level) return;
    this.shownFor = s.level;
    setText(this.eyebrow, s.levelIndex >= 0 ? `Level ${s.levelIndex + 1} of ${s.levelCount}` : 'Challenge');
    setText(this.title, s.level.name);
    setText(this.tagline, s.level.tagline);
    // Matches the tool the level starts with, so following the card never digs where it said to build.
    setText(this.nudge, s.level.startTool === 'raise' ? 'or just start building' : 'or just start digging');
    this.facts.replaceChildren(...levelFacts(s.level));
  }
}

function levelFacts(level: LevelDefinition): HTMLElement[] {
  const fact = (icon: string, text: string): HTMLElement =>
    h('span', { class: 'ls-fact' }, [h('span', { class: 'ls-icon', html: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { text })]);
  const n = level.villages.length;
  const facts = [fact(ICONS.house, `${n} ${n === 1 ? 'village' : 'villages'}`), fact(ICONS.clock, `Hold for ${formatClock(level.durationSec)}`)];
  if (peakStormRain(level) > 0) facts.push(fact(ICONS.storm, 'Storm incoming'));
  if (peakEruptionRate(level) > 0) facts.push(fact(ICONS.volcano, 'Eruption incoming'));
  if (level.place) facts.push(fact(ICONS.pin, 'Real map'));
  return facts;
}
