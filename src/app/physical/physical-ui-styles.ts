// Injects the physical-mode stylesheet once per document (self-contained so the module works in any host page).
import { PANEL_CSS } from './physical-ui-panel-css';
import { WIZARD_CSS } from './physical-ui-wizard-css';

const STYLE_ID = 'livesand-physical-ui-styles';

export function ensurePhysicalStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PANEL_CSS + WIZARD_CSS;
  doc.head.append(style);
}
