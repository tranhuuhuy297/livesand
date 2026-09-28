// Wizard step 4: drag the corners of the projected calibration grid onto the sandbox corners (CSS corner-pin).
import type { WizardStep, WizardStepContext } from './calibration-wizard-types';
import { button, el } from './dom-builder';
import { KeystoneEditor } from './keystone-editor';

export class ProjectorKeystoneStep implements WizardStep {
  readonly title = 'Align the projector';
  readonly short = 'Projector';
  readonly compact = true;
  private readonly ctx: WizardStepContext;
  private editor: KeystoneEditor | null = null;

  constructor(ctx: WizardStepContext) {
    this.ctx = ctx;
  }

  mount(body: HTMLElement): void {
    const surface = this.ctx.host.keystoneSurface;
    if (!surface.element) {
      body.append(el('p', {
        className: 'lsp-lead',
        text: 'No projector view is attached in this window, so there is nothing to align. Continue to save.',
      }));
      this.ctx.refresh();
      return;
    }
    this.editor = new KeystoneEditor(surface, this.ctx.layer, (q) => {
      this.ctx.draft.keystone = q;
    });
    this.editor.open(this.ctx.draft.keystone);
    body.append(
      el('p', {
        className: 'lsp-lead',
        text: 'Drag each coloured corner of the projected grid onto the matching corner of the sandbox.',
      }),
      el('p', {
        className: 'lsp-tip',
        text: 'Click a corner handle, then use the arrow keys for 1 px nudges (Shift = 10 px). The grid shows where the terrain will be drawn.',
      }),
      el('div', 'lsp-row', [
        button('Reset corners', () => this.editor?.reset(), 'lsp-btn lsp-btn--ghost'),
      ]),
    );
    this.ctx.refresh();
  }

  unmount(): void {
    this.editor?.close();
    this.editor = null;
  }

  tick(): void {
    // The editor reacts to pointer and resize events; nothing to poll.
  }

  canAdvance(): boolean {
    return true;
  }
}
