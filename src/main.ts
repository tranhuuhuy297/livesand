// Entry point: parse the URL, bring up WebGPU, then start virtual mode or (lazily loaded) projector mode.
import './styles.css';
import { parseAppUrlParams } from './app/app-url-params';
import { describeError, showFatalErrorScreen, showWebGpuUnavailableScreen } from './app/fatal-error-screen';
import { installLiveSandGlobal, reportLiveSandError } from './app/livesand-debug-api';
import { startVirtualMode } from './app/virtual-mode-app';
import { createGpuContext, WebGpuUnavailableError, type GpuContext } from './gpu/gpu-context';

async function boot(root: HTMLElement): Promise<void> {
  installLiveSandGlobal();
  const params = parseAppUrlParams(window.location.search);
  document.documentElement.dataset.mode = params.mode;

  let gpu: GpuContext;
  try {
    gpu = await createGpuContext();
  } catch (err) {
    if (!(err instanceof WebGpuUnavailableError)) throw err;
    reportLiveSandError(err.message);
    showWebGpuUnavailableScreen(root, err.message);
    return;
  }

  if (params.mode === 'projector') {
    // Separate chunk: the pairing QR code and depth pipeline are only needed next to a real sandbox.
    const { startProjectorMode } = await import('./app/projector-mode-app');
    await startProjectorMode(gpu, root, params);
  } else {
    await startVirtualMode(gpu, root, params);
  }
}

const root = document.getElementById('app') ?? document.body;
boot(root).catch((err: unknown) => {
  console.error('[livesand] startup failed:', err);
  const message = describeError(err);
  reportLiveSandError(message);
  showFatalErrorScreen(root, message);
});
