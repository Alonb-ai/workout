// Bumps the iOS build number (CURRENT_PROJECT_VERSION) for EVERY target in the
// Xcode project — the app and the RestTimerWidget extension must match, or App
// Store Connect rejects the upload. Usage: npm run ios:bump
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url);
const src = readFileSync(path, 'utf8');
const current = [...src.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
if (current.length === 0) throw new Error('CURRENT_PROJECT_VERSION not found');
const next = Math.max(...current) + 1;
writeFileSync(path, src.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${next};`));
console.log(`iOS build number → ${next} (${current.length} build configurations)`);
