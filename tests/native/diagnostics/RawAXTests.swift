import XCTest

// Independent diagnostics and separate post-Maestro semantic qualification.
final class RawAXTests: XCTestCase {
  func testInstalledAppTree() throws {
    let smoke = ProcessInfo.processInfo.environment["KC_AX_SMOKE_CONTROL"] == "1"
    let app: XCUIApplication
    if smoke {
      let control = XCUIApplication(bundleIdentifier: "org.karmacommunity.diagnostic.axcontrol")
      control.launch()
      app = control
    } else {
      app = XCUIApplication(bundleIdentifier: "org.karmacommunity.app")
    }
    // The caller must already install and launch the exact candidate. Do not relaunch,
    // activate, clear data, change accessibility settings, or add fallback taps here.
    guard app.state == XCUIApplication.State.runningForeground else {
      throw NSError(domain: "KCAXDiagnosticAppNotForeground", code: 1)
    }
    if smoke && !app.staticTexts["ax-control-label"].exists {
      throw NSError(domain: "KCAXDiagnosticControlLabelMissing", code: 2)
    }
    let tree = XCTAttachment(string: String(app.debugDescription.prefix(131072)))
    tree.name = "private-xctest-raw-accessibility-tree"
    tree.lifetime = .keepAlways
    add(tree)
    // Values are counts/booleans only; labels and values stay in private attachments.
    let guest = app.descendants(matching: .any).matching(identifier: "auth-guest-entry")
    print("KC_XCTEST_AX_DIAGNOSTIC guestCount=\(guest.count) windows=\(app.windows.count)")
  }
  func testSemanticGuestBrowse() throws {
    let app = XCUIApplication(bundleIdentifier: "org.karmacommunity.app")
    // Post-Maestro state only. Never launch, activate, reset or use coordinates.
    guard app.state == XCUIApplication.State.runningForeground else {
      throw NSError(domain: "KCGuestQualificationNotForeground", code: 1)
    }
    continueAfterFailure = false
    func capture(_ stage: String) {
      let shot = XCTAttachment(screenshot: app.screenshot())
      shot.name = "private-guest-" + stage
      shot.lifetime = .keepAlways
      add(shot)
      let tree = XCTAttachment(string: String(app.debugDescription.prefix(131072)))
      tree.name = "private-guest-tree-" + stage
      tree.lifetime = .keepAlways
      add(tree)
    }
    defer { capture("final") }
    let guest = app.descendants(matching: .any).matching(identifier: "auth-guest-entry").firstMatch
    XCTAssertTrue(guest.waitForExistence(timeout: 30))
    XCTAssertTrue(guest.isHittable)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "push-gate-accept").firstMatch.exists)
    capture("welcome")
    guest.tap()
    let posts = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "guest-post-"))
    XCTAssertTrue(posts.firstMatch.waitForExistence(timeout: 45))
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-empty").firstMatch.exists)
    XCTAssertTrue(posts.firstMatch.isHittable)
    capture("list")
    posts.firstMatch.tap()
    let back = app.descendants(matching: .any).matching(identifier: "guest-back").firstMatch
    XCTAssertTrue(back.waitForExistence(timeout: 30))
    XCTAssertTrue(posts.firstMatch.exists)
    capture("detail")
    XCTAssertTrue(back.isHittable)
    back.tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "guest-sign-in").firstMatch.waitForExistence(timeout: 30))
    capture("returned-list")
    print("KC_XCTEST_GUEST_POST_MAESTRO tap/list/detail/back assertions passed")
  }

}
