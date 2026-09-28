// Turns the physical-mode state into the user-facing PhysicalStatus (one message, most important problem first).
import type { RelayConnectionState } from './depth-stream-client';

export interface PhysicalStatus {
  connected: boolean;
  sources: number;
  fps: number;
  calibrated: boolean;
  message: string;
}

export interface PhysicalStatusInputs {
  connection: RelayConnectionState;
  relayHost: string;
  retryInMs: number | null;
  lastError: string | null;
  sources: number;
  fps: number;
  live: boolean;
  frameSize: { width: number; height: number } | null;
  wizardOpen: boolean;
  /** Saved calibration exists but was made for another depth image size. */
  mismatch: string | null;
  calibrated: boolean;
  usingRough: boolean;
  hasCalibration: boolean;
  problem: string | null;
}

export function describePhysicalStatus(i: PhysicalStatusInputs): PhysicalStatus {
  const fps = Math.round(i.fps);
  const size = i.frameSize ? `${i.frameSize.width}×${i.frameSize.height}` : '';
  let message: string;
  if (i.connection !== 'open') {
    if (i.lastError?.startsWith('Invalid relay URL')) message = i.lastError;
    else if (i.retryInMs !== null) {
      message = `Can't reach the relay at ${i.relayHost}; retrying in ${Math.max(1, Math.ceil(i.retryInMs / 1000))} s (start it with "npx livesand")`;
    } else message = `Connecting to the relay at ${i.relayHost}…`;
  } else if (!i.live) {
    message = i.sources > 0
      ? 'Depth camera connected; waiting for depth frames…'
      : 'Relay connected; waiting for a depth camera (scan the pairing QR)';
  } else if (i.wizardOpen) message = `Calibrating · live depth ${size} @ ${fps} fps`;
  else if (i.mismatch) message = i.mismatch;
  else if (!i.hasCalibration) message = 'Calibration needed';
  else if (i.usingRough) message = `Live depth ${size} @ ${fps} fps · rough calibration (calibrate for accurate terrain)`;
  else message = `Live depth ${size} @ ${fps} fps`;
  if (i.problem) message += ` · ${i.problem}`;
  return { connected: i.connection === 'open', sources: i.sources, fps: i.live ? fps : 0, calibrated: i.calibrated, message };
}

export function sameStatus(a: PhysicalStatus, b: PhysicalStatus): boolean {
  return a.connected === b.connected && a.sources === b.sources && a.fps === b.fps && a.calibrated === b.calibrated && a.message === b.message;
}
