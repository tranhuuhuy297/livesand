import Combine
import Foundation
import UIKit

/// UI state + orchestration: relay URL persistence, permissions, start/stop, and status from the background workers.
@MainActor
final class DepthStreamController: ObservableObject {
    private static let relayURLDefaultsKey = "relaySourceURL"

    @Published var relayURLText: String {
        didSet { UserDefaults.standard.set(relayURLText, forKey: Self.relayURLDefaultsKey) }
    }
    @Published private(set) var isStreaming = false
    @Published private(set) var connection: RelayConnectionState = .idle
    @Published private(set) var stats = DepthStreamStats()
    @Published private(set) var arNotice: String? = nil
    @Published private(set) var errorMessage: String? = nil
    @Published private(set) var cameraAccessDenied = false

    let lidarSupported: Bool

    private let client: RelayWebSocketClient
    private let streamer: LidarDepthStreamer
    private var subscriptions = Set<AnyCancellable>()

    init() {
        _relayURLText = Published(initialValue: UserDefaults.standard.string(forKey: Self.relayURLDefaultsKey) ?? "")
        lidarSupported = LidarDepthStreamer.isSupported
        let client = RelayWebSocketClient()
        self.client = client
        streamer = LidarDepthStreamer(client: client)

        // Workers emit on their own queues; DispatchQueue.main keeps delivery ordered on the main thread.
        client.stateChanges
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.connection = state }
            .store(in: &subscriptions)
        streamer.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in self?.handle(event) }
            .store(in: &subscriptions)
    }

    func toggleStreaming() {
        if isStreaming { stopStreaming() } else { startStreaming() }
    }

    func startStreaming() {
        guard !isStreaming else { return }
        errorMessage = nil
        guard lidarSupported else {
            errorMessage = "This device has no LiDAR scanner (needs iPhone 12 Pro or newer Pro, or iPad Pro 2020+)."
            return
        }
        guard let url = RelayURLParser.sourceURL(from: relayURLText) else {
            errorMessage = "Enter the relay URL (ws://<computer-ip>:8787/ws?role=source) or scan the pairing QR code."
            return
        }
        relayURLText = url.absoluteString
        isStreaming = true  // set before awaiting so a double tap cannot start twice
        Task {
            let granted = await CameraPermission.requestIfNeeded()
            guard isStreaming else { return }  // user pressed Stop while the prompt was up
            guard granted else {
                isStreaming = false
                cameraAccessDenied = true
                errorMessage = "Camera access is off. Enable it in Settings to stream LiDAR depth."
                return
            }
            cameraAccessDenied = false
            stats = DepthStreamStats()
            client.connect(to: url)
            streamer.start()
            UIApplication.shared.isIdleTimerDisabled = true  // projector setups run unattended for a long time
        }
    }

    func stopStreaming() {
        isStreaming = false
        streamer.stop()
        client.disconnect()
        stats.fps = 0
        arNotice = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    /// Frees the camera before the QR scanner needs it (ARKit and AVCaptureSession cannot share it).
    func prepareForScanning() {
        if isStreaming { stopStreaming() }
        errorMessage = nil
    }

    /// Returns true when the scanned text is a usable relay URL (the scanner then closes).
    func useScannedCode(_ code: String) -> Bool {
        guard let url = RelayURLParser.sourceURL(from: code) else { return false }
        relayURLText = url.absoluteString
        errorMessage = nil
        return true
    }

    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func handle(_ event: DepthStreamerEvent) {
        switch event {
        case .stats(let newStats):
            if isStreaming { stats = newStats }
        case .notice(let message):
            arNotice = message
        case .failed(let message):
            stopStreaming()
            errorMessage = message
        }
    }
}
