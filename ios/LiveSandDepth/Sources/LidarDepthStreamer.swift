import ARKit
import Combine
import CoreVideo
import Foundation

/// Counters published to the UI while streaming.
struct DepthStreamStats: Equatable, Sendable {
    var fps: Double = 0
    var framesSent: UInt64 = 0
    var framesDropped: UInt64 = 0  // skipped because the socket was busy or not connected
    var depthWidth = 0
    var depthHeight = 0
}

enum DepthStreamerEvent: Sendable {
    case stats(DepthStreamStats)
    case notice(String?)  // transient AR status; nil clears it
    case failed(String)   // the AR session stopped for good
}

/// Runs ARKit scene depth and forwards throttled LSD1 frames to the relay client.
///
/// ARKit delivers delegate callbacks on `queue`, so depth conversion never touches the main thread and
/// every mutable property below is confined to that serial queue.
final class LidarDepthStreamer: NSObject, ARSessionDelegate, @unchecked Sendable {
    /// LiDAR devices only; false on the simulator and on phones without the scanner.
    static var isSupported: Bool { ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) }

    /// Emits on the processing queue; subscribers should `receive(on:)` their own scheduler.
    let events = PassthroughSubject<DepthStreamerEvent, Never>()

    private let arSession = ARSession()
    private let queue = DispatchQueue(label: "io.livesand.depth.frames", qos: .userInitiated)
    private let client: RelayWebSocketClient
    private let frameInterval: TimeInterval

    private var isRunning = false
    private var lastAcceptedAt: TimeInterval = 0
    private var frameIndex: UInt32 = 0
    private var stats = DepthStreamStats()
    private var windowStart: TimeInterval = 0
    private var windowSent = 0
    private var reportedEncodeError = false

    init(client: RelayWebSocketClient, targetFPS: Double = 30) {
        self.client = client
        frameInterval = 1 / max(1, targetFPS)
        super.init()
        arSession.delegate = self
        arSession.delegateQueue = queue
    }

    /// Starts the AR session; call from the main thread after camera permission is granted.
    func start() {
        let configuration = ARWorldTrackingConfiguration()
        var semantics: ARConfiguration.FrameSemantics = .sceneDepth
        // Smoothed depth averages several frames: far less shimmer on a static sand surface.
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
            semantics.insert(.smoothedSceneDepth)
        }
        configuration.frameSemantics = semantics
        queue.async {
            self.resetCounters()
            self.isRunning = true
        }
        arSession.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        arSession.pause()
        queue.async { self.isRunning = false }
    }

    // MARK: - ARSessionDelegate (on `queue`)

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard isRunning else { return }
        let captureTime = frame.timestamp
        // ARKit runs at 60 Hz; a few ms of slack keeps every other frame despite timestamp jitter.
        guard captureTime - lastAcceptedAt >= frameInterval - 0.005 else { return }
        lastAcceptedAt = captureTime
        // Copy what we need and let the ARFrame go: holding frames starves ARKit's buffer pool.
        guard let depthMap = (frame.smoothedSceneDepth ?? frame.sceneDepth)?.depthMap else { return }
        stats.depthWidth = CVPixelBufferGetWidth(depthMap)
        stats.depthHeight = CVPixelBufferGetHeight(depthMap)
        if client.isReadyToSend {
            send(depthMap, captureTime: captureTime)
        } else {
            stats.framesDropped += 1
        }
        publishStatsIfDue(now: captureTime)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        let message: String
        if let arError = error as? ARError, arError.code == .cameraUnauthorized {
            message = "Camera access is off. Allow it in Settings to stream depth."
        } else {
            message = "AR session failed: \(error.localizedDescription)"
        }
        events.send(.failed(message))
    }

    func sessionWasInterrupted(_ session: ARSession) {
        events.send(.notice("Camera interrupted. Keep the app in the foreground."))
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        events.send(.notice(nil))
    }

    // MARK: - Queue-confined internals

    private func send(_ depthMap: CVPixelBuffer, captureTime: TimeInterval) {
        do {
            let data = try DepthFrameEncoder.encode(
                depthMap: depthMap,
                timestampMs: Self.epochMilliseconds(fromUptime: captureTime),
                frameIndex: frameIndex
            )
            if client.send(data) {
                frameIndex &+= 1
                stats.framesSent += 1
                windowSent += 1
            } else {
                stats.framesDropped += 1
            }
        } catch {
            stats.framesDropped += 1
            if !reportedEncodeError {  // same error would repeat every frame
                reportedEncodeError = true
                events.send(.notice(error.localizedDescription))
            }
        }
    }

    private func publishStatsIfDue(now: TimeInterval) {
        if windowStart == 0 {
            windowStart = now
            return
        }
        let elapsed = now - windowStart
        guard elapsed >= 0.5 else { return }
        stats.fps = Double(windowSent) / elapsed
        windowStart = now
        windowSent = 0
        events.send(.stats(stats))
    }

    private func resetCounters() {
        lastAcceptedAt = 0
        frameIndex = 0
        stats = DepthStreamStats()
        windowStart = 0
        windowSent = 0
        reportedEncodeError = false
    }

    /// ARFrame timestamps use the uptime clock; the wire carries wall-clock ms so the browser can gauge latency.
    private static func epochMilliseconds(fromUptime uptime: TimeInterval) -> Double {
        let age = ProcessInfo.processInfo.systemUptime - uptime
        return (Date().timeIntervalSince1970 - age) * 1000
    }
}
