import { Dashboard } from './ui/dashboard.js';
import { SimulatedRower } from './rower/SimulatedRower.js';
import { Pm5Connection } from './rower/Pm5Connection.js';
import { RowingScene } from './scene/RowingScene.js';
import { PaceBoat } from './paceBoat.js';

const dashboard = new Dashboard();
const scene = new RowingScene(document.getElementById('scene'));
scene.start();

const paceBoat = new PaceBoat();
let latestSample = null;
let activeSource = null;

/** Swap the active RowerSource. A fresh instance each time keeps state clean. */
async function activate(createSource) {
  if (activeSource) await activeSource.stop();
  activeSource = createSource();
  dashboard.attach(activeSource);
  activeSource.on('sample', (sample) => {
    latestSample = sample;
    scene.applySample(sample);
    paceBoat.applySample(sample);
    scene.updatePaceBoat(paceBoat.state);
  });
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

/** Starting it level with your current pace makes "hold this" a single keystroke. */
function togglePaceBoat() {
  if (paceBoat.enabled) {
    paceBoat.disable();
  } else {
    paceBoat.enable(latestSample?.paceSecPer500);
  }
  scene.updatePaceBoat(paceBoat.state);
}

function adjustPaceBoat(deltaSec) {
  if (!paceBoat.enabled) return;
  paceBoat.adjustTargetPace(deltaSec);
  scene.updatePaceBoat(paceBoat.state);
}

dashboard.bindControls({ onConnect: connectRower, onDemo: toggleDemo });
dashboard.bindPaceBoat({ getState: () => paceBoat.state, onToggle: togglePaceBoat });
dashboard.bindKeyboardShortcuts({
  onFullscreenToggle: () => dashboard.toggleFullscreen(),
  onDemoToggle: toggleDemo,
  onPaceBoatToggle: togglePaceBoat,
  onPaceBoatAdjust: adjustPaceBoat,
});

if (!Pm5Connection.isSupported()) {
  dashboard.setConnectButtonEnabled(false);
  dashboard.showMessage(
    'Web Bluetooth is not available in this browser. Open this page in Chrome or Edge to connect a PM5. Demo mode still works here.',
  );
}
