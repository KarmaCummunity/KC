import XCTest

// Diagnostic only. This does not interact with the app or qualify guest acceptance.
final class RawAXTests: XCTestCase {
  func testInstalledAppTree() throws {
    let app = XCUIApplication(bundleIdentifier: "org.karmacommunity.app")
    // The caller must already install and launch the exact candidate. Do not relaunch,
    // activate, clear data, change accessibility settings, or add fallback taps here.
    guard app.state == XCUIApplication.State.runningForeground else {
      throw NSError(domain: "KCAXDiagnosticAppNotForeground", code: 1)
    }
    let tree = XCTAttachment(string: String(app.debugDescription.prefix(131072)))
    tree.name = "private-xctest-raw-accessibility-tree"
    tree.lifetime = .keepAlways
    add(tree)
    // Values are counts/booleans only; labels and values stay in private attachments.
    let guest = app.descendants(matching: .any).matching(identifier: "auth-guest-entry")
    print("KC_XCTEST_AX_DIAGNOSTIC guestCount=\(guest.count) windows=\(app.windows.count)")
  }
}
