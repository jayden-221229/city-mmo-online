// Regression coverage for independent and global collapsible UI controls.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/style.css'), 'utf8');

for (const id of [
  'uiMasterToggle', 'hudCollapseToggle', 'hudRestoreChip',
  'minimapCollapseToggle', 'minimapRestoreChip',
  'questsCollapseToggle', 'questsRestoreChip',
  'socialCollapseToggle', 'socialRestoreChip', 'paletteCollapseToggle'
]) assert(new RegExp('id="' + id + '"').test(html), 'UI fold control exists: ' + id);
assert(/body\.ui-hidden #palette/.test(css), 'master fold hides the building palette');
assert(/body\.ui-hidden #transitPanel/.test(css), 'master fold hides transit configuration panels');
assert(/body\.ui-hidden #modePanel/.test(css), 'master fold hides mode/theme panels');
for (const cls of ['hud-collapsed', 'minimap-collapsed', 'quests-collapsed', 'social-collapsed']) {
  assert(html.includes("cls: '" + cls + "'"), 'individual fold state exists: ' + cls);
}
assert(/citymmo\.uiFold\.all\.v1/.test(html), 'global fold state is persisted');
assert(/event\.key !== 'F2'/.test(html), 'F2 shortcut is installed');
assert(/info-close/.test(fs.readFileSync(path.join(root, 'assets/js/game.js'), 'utf8')), 'building info panel can be dismissed');
console.log('UI fold controls tests passed: independent panels, global hide/show, persistence and shortcuts');
