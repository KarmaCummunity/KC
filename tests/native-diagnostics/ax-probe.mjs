// Isolated DEV diagnostics only. This file is never imported by application code.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const AX_PROBE = `
// Fixed shape/flags only, no labels, values, account data or arbitrary identifiers.
private enum KCAXDiagnostic {
  static var observer: NSObjectProtocol?
  static func install() {
    observer = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { _ in
      for delay in [1.0, 5.0, 15.0] {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { capture() }
      }
    }
  }
  static func capture() {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
    var remaining = 240
    NSLog("KC_AX_DIAGNOSTIC windows=%d", windows.count)
    for window in windows.prefix(8) {
      NSLog("KC_AX_DIAGNOSTIC window key=%d level=%.1f frame=%@", window.isKeyWindow ? 1 : 0, window.windowLevel.rawValue, NSCoder.string(for: window.frame))
      walk(window, depth: 0, remaining: &remaining)
    }
  }
  static func walk(_ view: UIView, depth: Int, remaining: inout Int) {
    guard remaining > 0, depth < 28 else { return }
    remaining -= 1
    let guest = view.accessibilityIdentifier == "auth-guest-entry"
    NSLog("KC_AX_DIAGNOSTIC view class=%@ depth=%d frame=%@ hidden=%d alpha=%.2f ax=%d axHidden=%d axModal=%d guest=%d children=%d explicitAX=%d", NSStringFromClass(type(of: view)), depth, NSCoder.string(for: view.frame), view.isHidden ? 1 : 0, view.alpha, view.isAccessibilityElement ? 1 : 0, view.accessibilityElementsHidden ? 1 : 0, view.accessibilityViewIsModal ? 1 : 0, guest ? 1 : 0, view.subviews.count, view.accessibilityElements?.count ?? -1)
    for child in view.subviews { walk(child, depth: depth + 1, remaining: &remaining) }
  }
}
`;

export function instrumentAppDelegate(source) {
  const anchor = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';
  if (source.includes('KCAXDiagnostic') || source.split(anchor).length !== 2) {
    throw new Error('AppDelegate diagnostic anchor missing, duplicated or already instrumented');
  }
  return source.replace(anchor, `KCAXDiagnostic.install()\n    ${anchor}`) + AX_PROBE;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = process.argv[2];
  if (!path) throw new Error('AppDelegate path required');
  writeFileSync(path, instrumentAppDelegate(readFileSync(path, 'utf8')));
}
