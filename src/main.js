import { Dashboard } from './ui/dashboard.js';
import { SimulatedRower } from './rower/SimulatedRower.js';
import { Pm5Connection } from './rower/Pm5Connection.js';

const dashboard = new Dashboard();

let activeSource = null;

/** Swap the active RowerSource. A fresh instance each time keeps state clean. */
async function activate(createSource) {
  if (activeSource) await activeSource.stop();
  activeSource = createSource();
  dashboard.attach(activeSource);
  activeSource.start();
  dashboard.requestWakeLockForSession();
}

function connectRower() {
  activate(() => new Pm5Connection());
}

function toggleDemo() {
  if (activeSource instanceof SimulatedRower) {
    activeSource.stop();
    activeSource = null;
    return;
  }
  activate(() => new SimulatedRower());
}

dashboard.bindControls({ onConnect: connectRower, onDemo: toggleDemo });
dashboard.bindKeyboardShortcuts({
  onFullscreenToggle: () => dashboard.toggleFullscreen(),
  onDemoToggle: toggleDemo,
});

if (!Pm5Connection.isSupported()) {
  dashboard.setConnectButtonEnabled(false);
  dashboard.showMessage(
    'Web Bluetooth is not available in this browser. Open this page in Chrome or Edge to connect a PM5. Demo mode still works here.',
  );
}
