import UIKit

// Synthetic harness control only, never part of KC.
@main
final class AXControlApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    let label = UILabel(frame: CGRect(x: 40, y: 100, width: 300, height: 100))
    label.text = "Diagnostic control"
    label.accessibilityIdentifier = "ax-control-label"
    controller.view.addSubview(label)
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}
