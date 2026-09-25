import { Dashboard } from './ui/dashboard.js';
import { SimulatedRower } from './rower/SimulatedRower.js';
import { Pm5Connection } from './rower/Pm5Connection.js';
import { RowingScene } from './scene/RowingScene.js';

const dashboard = new Dashboard();
const scene = new RowingScene(document.getElementById('scene'));
scene.start();

let activeSource = null;

/** Swap the active RowerSource. A fresh instance each time keeps state clean. */
async function activate(createSource) {
  if (activeSource) await activeSource.stop();
  activeSource = createSource();
  dashboard.attach(activeSource);
  activeSource.on('sample', (sample) => scene.applySample(sample));
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
    scene.rest();
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
