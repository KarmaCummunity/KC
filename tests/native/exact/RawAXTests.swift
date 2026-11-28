import XCTest

// Independent UI test process. No changes or injected diagnostics in the target app.
final class RawAXTests: XCTestCase {
  func testExactFreshGuestBrowse() throws {
    let app = XCUIApplication(bundleIdentifier: "org.karmacommunity.app")
    // Fresh simulator, unchanged app. A single cold launch, no reset or fallback.
    app.launch()
    guard app.state == XCUIApplication.State.runningForeground else {
      throw NSError(domain: "KCGuestQualificationNotForeground", code: 1)
    }
    continueAfterFailure = false
    func capture(_ stage: String) {
      // Capture the full display: app-scoped capture crops iPhone compatibility windows on iPad.
      let state = app.state
      let stateProof = XCTAttachment(string: "stage=\(stage) state=\(state.rawValue) frame=\(app.frame)")
      stateProof.name = "private-guest-state-" + stage
      stateProof.lifetime = .keepAlways
      add(stateProof)
      XCTAssertEqual(state, XCUIApplication.State.runningForeground)
      let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
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
    let selectedId = posts.firstMatch.identifier
    posts.firstMatch.tap()
    let back = app.descendants(matching: .any).matching(identifier: "guest-back").firstMatch
    XCTAssertTrue(back.waitForExistence(timeout: 30))
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: selectedId).firstMatch.exists)
    capture("detail")
    XCTAssertTrue(back.isHittable)
    back.tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "guest-sign-in").firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: selectedId).firstMatch.exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-empty").firstMatch.exists)
    capture("returned-list")
    print("KC_XCTEST_EXACT_FRESH_GUEST tap/list/detail/back assertions passed")
  }

}
