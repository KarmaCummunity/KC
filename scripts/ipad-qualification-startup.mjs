// DEV diagnostic transform only. Never imported by app code or store workflows.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Add fixed, non-personal startup markers without changing branch decisions. */
export function instrumentStartup(source) {
  const replacements = [
    ['      const stored = await loadStoredLanguageAsync();', '      console.warn("KC_STARTUP_DIAGNOSTIC rtl-read-start");\n      const stored = await loadStoredLanguageAsync();\n      console.warn("KC_STARTUP_DIAGNOSTIC rtl-read-finished");'],
    ['      const needsReload = I18nManager.isRTL !== isRtlLanguage(desired);', '      const needsReload = I18nManager.isRTL !== isRtlLanguage(desired);\n      console.warn("KC_STARTUP_DIAGNOSTIC rtl-needs-reload", needsReload);'],
    ['      if (needsReload) reloadApp();', '      if (needsReload) { console.warn("KC_STARTUP_DIAGNOSTIC rtl-reload-call"); reloadApp(); }'],
  ];
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error('Diagnostic anchor changed or duplicated');
    result = result.replace(before, after);
  }
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = 'app/apps/mobile/app/_layout.tsx';
  writeFileSync(path, instrumentStartup(readFileSync(path, 'utf8')));
}
