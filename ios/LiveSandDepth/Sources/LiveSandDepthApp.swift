import SwiftUI

@main
struct LiveSandDepthApp: App {
    // Owned here so the stream survives view rebuilds for the whole app lifetime.
    @StateObject private var controller = DepthStreamController()

    var body: some Scene {
        WindowGroup {
            ContentView(controller: controller)
        }
    }
}
