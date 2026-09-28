import SwiftUI

struct ContentView: View {
    @ObservedObject var controller: DepthStreamController
    @State private var isScannerPresented = false

    var body: some View {
        NavigationStack {
            Form {
                if !controller.lidarSupported {
                    Section {
                        Label(
                            "No LiDAR scanner on this device. LiveSand needs an iPhone 12 Pro or newer Pro model, or an iPad Pro (2020+).",
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .foregroundStyle(.orange)
                    }
                }
                relaySection
                streamSection
                if let error = controller.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                        if controller.cameraAccessDenied {
                            Button("Open Settings") { controller.openSystemSettings() }
                        }
                    }
                }
                Section("Mounting") {
                    Text("Hold the phone 1–1.5 m above the sand, camera pointing straight down, so the whole box is in view. Then calibrate the corners in the browser.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("LiveSand Depth")
        }
        .sheet(isPresented: $isScannerPresented) { scannerSheet }
    }

    private var relaySection: some View {
        Section {
            TextField("ws://192.168.1.20:8787/ws?role=source", text: $controller.relayURLText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(controller.isStreaming)
            Button {
                controller.prepareForScanning()
                isScannerPresented = true
            } label: {
                Label("Scan pairing QR code", systemImage: "qrcode.viewfinder")
            }
        } header: {
            Text("Relay")
        } footer: {
            Text("Run `npx livesand` on your computer, open the web app, and scan the QR code in its \u{201C}Connect iPhone\u{201D} panel.")
        }
    }

    private var streamSection: some View {
        Section("Stream") {
            Button {
                controller.toggleStreaming()
            } label: {
                Label(
                    controller.isStreaming ? "Stop streaming" : "Start streaming",
                    systemImage: controller.isStreaming ? "stop.circle.fill" : "play.circle.fill"
                )
            }
            .disabled(!controller.lidarSupported)
            LabeledContent("Connection") {
                Text(controller.connection.displayText)
                    .foregroundStyle(controller.connection.displayColor)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Frame rate", value: String(format: "%.1f fps", controller.stats.fps))
            LabeledContent("Frames sent", value: "\(controller.stats.framesSent)")
            LabeledContent("Frames dropped", value: "\(controller.stats.framesDropped)")
            if controller.stats.depthWidth > 0 {
                LabeledContent("Depth map", value: "\(controller.stats.depthWidth) × \(controller.stats.depthHeight)")
            }
            if let notice = controller.arNotice {
                Text(notice).font(.footnote).foregroundStyle(.orange)
            }
        }
    }

    private var scannerSheet: some View {
        NavigationStack {
            QRCodeScannerView { code in
                let accepted = controller.useScannedCode(code)
                if accepted { isScannerPresented = false }
                return accepted
            }
            .ignoresSafeArea()
            .navigationTitle("Scan pairing QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isScannerPresented = false }
                }
            }
        }
    }
}

private extension RelayConnectionState {
    var displayText: String {
        switch self {
        case .idle: return "Not connected"
        case .connecting: return "Connecting…"
        case .connected: return "Connected"
        case let .reconnecting(seconds, reason): return "Retrying in \(String(format: "%.1f", seconds)) s: \(reason)"
        case .stopped: return "Stopped by the relay"
        }
    }

    var displayColor: Color {
        switch self {
        case .idle: return .secondary
        case .connecting, .reconnecting, .stopped: return .orange
        case .connected: return .green
        }
    }
}
