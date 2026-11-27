// DEV diagnostic transform only. Never imported by app code or store workflows.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function replaceAnchors(source, replacements) {
  if (source.includes("KC_STARTUP_DIAGNOSTIC")) throw new Error("Diagnostic anchor already instrumented");
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error('Diagnostic anchor changed or duplicated');
    result = result.replace(before, after);
  }
  return result;
}

/** Add fixed, non-personal startup markers without changing branch decisions. */
export function instrumentStartup(source) {
  return replaceAnchors(source, [
    ["void SplashScreen.preventAutoHideAsync();", 'console.warn("KC_STARTUP_DIAGNOSTIC module-loaded");\nvoid SplashScreen.preventAutoHideAsync();'],
    ['export default function RootLayout() {', 'export default function RootLayout() {\n  console.warn("KC_STARTUP_DIAGNOSTIC root-render");'],
    ['  const brandFontStatus = useBrandFonts();', '  const brandFontStatus = useBrandFonts();\n  console.warn("KC_STARTUP_DIAGNOSTIC font-status", brandFontStatus);'],
    ['function RootLayoutContent() {', 'function RootLayoutContent() {\n  console.warn("KC_STARTUP_DIAGNOSTIC content-render");'],
    ['    return setupQueryLifecycleSync();', '    console.warn("KC_STARTUP_DIAGNOSTIC content-effect");\n    return setupQueryLifecycleSync();'],
  ]);
}

export function instrumentLanguageBootstrap(source) {
  return replaceAnchors(source, [
    ['      const stored = await loadStoredLanguageAsync();', '      console.warn("KC_STARTUP_DIAGNOSTIC rtl-read-start");\n      const stored = await loadStoredLanguageAsync();\n      console.warn("KC_STARTUP_DIAGNOSTIC rtl-read-finished");'],
    ['      const needsReload = I18nManager.isRTL !== isRtlLanguage(desired);', '      const needsReload = I18nManager.isRTL !== isRtlLanguage(desired);\n      console.warn("KC_STARTUP_DIAGNOSTIC rtl-needs-reload", needsReload);'],
    ['        reloadApp();', '        console.warn("KC_STARTUP_DIAGNOSTIC rtl-reload-call");\n        reloadApp();'],
    ['      setReady(true);', '      console.warn("KC_STARTUP_DIAGNOSTIC language-ready");\n      setReady(true);'],
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, instrument] of [
    ['app/apps/mobile/app/_layout.tsx', instrumentStartup],
    ['app/apps/mobile/src/i18n/useLanguageBootstrap.ts', instrumentLanguageBootstrap],
  ]) writeFileSync(path, instrument(readFileSync(path, 'utf8')));
}
