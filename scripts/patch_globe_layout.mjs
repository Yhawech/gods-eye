import fs from 'node:fs';
import path from 'node:path';
import { patchNativeDataLayers } from './globe_native_patches.mjs';

const root = process.cwd();
const installPath = process.argv[2] || 'tmp/gods-eye-view';
const target = path.resolve(root, installPath);
const mainPath = path.join(target, 'src/main.js');
const htmlPath = path.join(target, 'index.html');
const cssPath = path.join(target, 'style.css');
const envPath = path.join(target, '.env');
const enhancementPath = path.join(target, 'src/godsEyeOsintEnhancements.js');
const enhancementSourcePath = path.join(root, 'scripts/globe_osint_enhancements.js');
const cssPatchPath = path.join(root, 'scripts/globe_osint_patch.css');

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required globe companion file not found: ${filePath}. Run npm run setup:globe first.`);
  }
}

function read(filePath) {
  requireFile(filePath);
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, text) {
  fs.writeFileSync(filePath, text, 'utf8');
}

function patchMain() {
  let text = read(mainPath);
  // Street Traffic was removed from the globe UI because no reliable free live-global feed is available.
  text = text.replace(/import trafficLayer from '.\/data\/traffic.js';\r?\n/g, '');
  text = text.replace(/\s*dataManager\.register\(trafficLayer\);\r?\n/g, '\n');
  if (!text.includes("godsEyeOsintEnhancements.js")) {
    text = text.replace(
      'initLogoGaze();',
      "import { initGodsEyeOsintEnhancements } from './godsEyeOsintEnhancements.js';\n\ninitLogoGaze();"
    );
  }
  text = text.replace(/import \{ initGevVoiceCommands \} from '\.\/voice\/gevRealtime\.js';\r?\n/g, '');
  text = text.replace(
    /\s*window\.__godsEyeView\.voiceCommands = initGevVoiceCommands\(\{ viewer, styleManager, dataManager, sceneDirector, annotations \}\);\r?\n/g,
    '\n    window.__godsEyeView.voiceCommands = null;\n'
  );
  if (!text.includes('initGodsEyeOsintEnhancements(window.__godsEyeView)')) {
    text = text.replace(
      /(window\.__godsEyeView\.voiceCommands = null;\r?\n)/,
      '$1    initGodsEyeOsintEnhancements(window.__godsEyeView);\n'
    );
  }
  write(mainPath, text);
}

function patchUi() {
  const uiPath = path.join(target, 'src/ui.js');
  let text = read(uiPath);
  text = text.replace(/import trafficLayer from '.\/data\/traffic.js';\r?\n/g, '');
  text = text.replace(/^\s*'#traffic-sync-chip',\r?\n/gm, '');
  text = text.replace(/^\s*this\._trafficSyncChip = document\.getElementById\('traffic-sync-chip'\);\r?\n/gm, '');
  text = text.replace(/initDetection\(viewer, \[trafficLayer,\s*/g, 'initDetection(viewer, [');
  text = text.replace(/^\s*trafficLayer\.(?:beginWorldJump|endWorldJump)\?\.\(\);\r?\n/gm, '');
  write(uiPath, text);

  const overlayPath = path.join(target, 'src/overlays/worldOverlay.js');
  if (fs.existsSync(overlayPath)) {
    let overlay = fs.readFileSync(overlayPath, 'utf8');
    overlay = overlay.replace(/^\s*'#traffic-sync-chip',\r?\n/gm, '');
    fs.writeFileSync(overlayPath, overlay, 'utf8');
  }
}
function patchHtml() {
  let text = read(htmlPath);
  text = text.replace(/\s*<div id="traffic-sync-chip"[\s\S]*?<\/div>\r?\n/g, '\n');
  if (!text.includes('id="gods-eye-back"')) {
    text = text.replace(
      '<p class="subtitle">NO PLACE LEFT BEHIND</p>',
      '<p class="subtitle">NO PLACE LEFT BEHIND</p>\n    <a id="gods-eye-back" href="http://127.0.0.1:4173/" title="Return to main GOD EYE dashboard">BACK TO MAIN MENU</a>'
    );
  }
  text = text.replace('Navigation, voice, and visual preset controls', 'Navigation and visual preset controls');
  text = text.replace('locations, voice (injected at runtime), visual presets', 'locations and visual presets');
  write(htmlPath, text);
}

function patchCss() {
  let text = read(cssPath);
  text = text.replace('/* GOD EYE integration patch: back button plus voice removal. */', '/* GOD EYE integration patch: back button. */');
  if (!text.includes('#gods-eye-back')) {
    text += `

/* GOD EYE integration patch: back button. */
#gods-eye-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 14px;
  width: fit-content;
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid rgba(0, 229, 255, 0.55);
  border-radius: 4px;
  background: rgba(3, 20, 28, 0.82);
  color: #00e5ff;
  font: 700 11px/1 'JetBrains Mono', monospace;
  letter-spacing: 0.18em;
  text-decoration: none;
  box-shadow: 0 0 18px rgba(0, 229, 255, 0.18), inset 0 0 16px rgba(0, 229, 255, 0.08);
  pointer-events: auto;
}

#gods-eye-back:hover,
#gods-eye-back:focus-visible {
  border-color: rgba(255, 255, 255, 0.9);
  color: #ffffff;
  outline: none;
}
`;
  }
  if (!/#gev-voice-control\s*\{\s*display:\s*none !important;\s*\}/.test(text)) {
    text += `
#gev-voice-control {
  display: none !important;
}
`;
  }
  const osintCss = fs.existsSync(cssPatchPath) ? fs.readFileSync(cssPatchPath, 'utf8').trimEnd() : '';
  if (osintCss && !text.includes('GOD EYE OSINT integration patch')) {
    text += `\n\n${osintCss}\n`;
  }
  write(cssPath, text);
}

function patchEnhancements() {
  requireFile(enhancementSourcePath);
  write(enhancementPath, read(enhancementSourcePath));
}

function ensureEnvLine(lines, key, value) {
  const matcher = new RegExp(`^${key}=`);
  if (lines.some((line) => matcher.test(line))) return lines;
  lines.push(`${key}=${value}`);
  return lines;
}

function patchEnv() {
  if (!fs.existsSync(envPath)) return;
  const kept = fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^VOICE_PROVIDER=/.test(line))
    .filter((line) => !/^GEMINI_/.test(line))
    .filter((line) => !/^GEV_RATELIMIT_GEMINI_PER_MIN=/.test(line))
    .filter((line) => !/Gemini voice/i.test(line))
    .filter((line) => !/^TOMTOM_API_KEY=/.test(line));
  if (!kept.some((line) => /^OPENAI_API_KEY=/.test(line))) {
    kept.push('OPENAI_API_KEY=');
  }
  ensureEnvLine(kept, 'FIRMS_MAP_KEY', process.env.FIRMS_MAP_KEY || '');
  ensureEnvLine(kept, 'AISSTREAM_API_KEY', process.env.AISSTREAM_API_KEY || '');
  ensureEnvLine(kept, 'CCTV_MAX_SOURCES', process.env.CCTV_MAX_SOURCES || '900');
  ensureEnvLine(kept, 'CCTV_AUSTIN_MAX_SOURCES', process.env.CCTV_AUSTIN_MAX_SOURCES || '120');
  ensureEnvLine(kept, 'CCTV_PREFER_AUSTIN', process.env.CCTV_PREFER_AUSTIN || '0');
  ensureEnvLine(kept, 'GLOBE_OSINT_ENABLED', process.env.GLOBE_OSINT_ENABLED || 'true');
  ensureEnvLine(kept, 'VITE_GLOBE_OSINT_ENABLED', process.env.GLOBE_OSINT_ENABLED || 'true');
  ensureEnvLine(kept, 'GLOBE_OSINT_REFRESH_MS', process.env.GLOBE_OSINT_REFRESH_MS || '300000');
  ensureEnvLine(kept, 'GLOBE_OSINT_MAX_ITEMS', process.env.GLOBE_OSINT_MAX_ITEMS || '80');
  fs.writeFileSync(envPath, kept.join('\n').replace(/\n+$/, '') + '\n', 'utf8');
}

patchMain();
patchUi();
patchHtml();
patchCss();
patchEnhancements();
patchNativeDataLayers(target);
patchEnv();
console.log(`Globe layout patch applied to ${target}`);
