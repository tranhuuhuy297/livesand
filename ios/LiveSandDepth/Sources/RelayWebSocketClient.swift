import Combine
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Streams binary frames to the relay over one WebSocket, paced by relay acks, reconnecting with backoff.
///
/// Thread-safety: every mutable property is confined to `queue`; public methods hop onto it.
final class RelayWebSocketClient: @unchecked Sendable {
    /// Emits on the client's private queue; subscribers should `receive(on:)` their own scheduler.
    let stateChanges = PassthroughSubject<RelayConnectionState, Never>()

    private let queue = DispatchQueue(label: "io.livesand.depth.relay", qos: .userInitiated)
    private let watchdog: DispatchSourceTimer
    private var url: URL?
    private var wantsConnection = false
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var connectionID = 0  // bumped on every open/close so late callbacks from old sockets are ignored
    private var state: RelayConnectionState = .idle
    private var stateSince: TimeInterval = 0
    private var backoff = ReconnectBackoff()
    private var window = FrameSendWindow()
    private var lastPingAt: TimeInterval = 0

    init() {
        watchdog = DispatchSource.makeTimerSource(queue: queue)
        watchdog.schedule(deadline: .now() + 1, repeating: 1)
        watchdog.setEventHandler { [weak self] in self?.tick() }
        watchdog.resume()
    }

    deinit {
        watchdog.cancel()
        session?.invalidateAndCancel()
    }

    /// Starts (or restarts) connecting to `url` and keeps reconnecting until `disconnect()`.
    func connect(to url: URL) {
        queue.async {
            self.url = url
            self.wantsConnection = true
            self.backoff.reset()
            self.openSocket()
        }
    }

    func disconnect() {
        queue.async {
            self.wantsConnection = false
            self.closeSocket()
            self.publish(.idle)
        }
    }

    /// Cheap pre-check so callers can skip encoding a frame that would be dropped anyway.
    var isReadyToSend: Bool {
        queue.sync { state == .connected && window.canSend }
    }

    /// Sends one binary message; returns false (frame dropped) when not connected or the send window is full.
    func send(_ frame: Data) -> Bool {
        queue.sync { () -> Bool in
            guard state == .connected, window.canSend, let task else { return false }
            window.didStartSend(at: Self.now())
            let id = connectionID
            task.send(.data(frame)) { [weak self] error in
                guard let self else { return }
                let failure = error?.localizedDescription
                self.queue.async { self.finishSend(connectionID: id, failure: failure) }
            }
            return true
        }
    }

    /// From RelaySocketDelegateProxy, on any thread.
    func socketDidOpen(_ socket: URLSessionTask) {
        queue.async {
            guard socket === self.task else { return }
            self.publish(.connected)
        }
    }

    func socketDidEnd(_ socket: URLSessionTask, reason: String, closeCode: Int? = nil) {
        queue.async {
            guard socket === self.task else { return }
            self.handleDrop(reason: reason, closeCode: closeCode)
        }
    }

    private func openSocket() {
        closeSocket()
        guard wantsConnection, let url else { return }
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        let delegate = RelaySocketDelegateProxy(client: self)
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: delegateQueue)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task
        publish(.connecting)
        task.resume()
        receiveNext(on: task, connectionID: connectionID)
    }

    private func closeSocket() {
        connectionID &+= 1
        window.reset()
        task?.cancel(with: .goingAway, reason: nil)
        session?.finishTasksAndInvalidate()  // one session per connection; invalidation frees its delegate
        task = nil
        session = nil
    }

    /// Reads relay acks; a pending receive is also what surfaces a closed or broken socket.
    private func receiveNext(on task: URLSessionWebSocketTask, connectionID id: Int) {
        task.receive { [weak self] result in
            guard let self else { return }
            let (text, failure) = (result.textMessage, result.failureDescription)
            let closeCode = task.closeCode.rawValue  // a relay close frame can surface here before the delegate
            self.queue.async {
                guard id == self.connectionID else { return }
                if let failure { return self.handleDrop(reason: failure, closeCode: closeCode) }
                if let text, let message = RelayControlMessage.parse(text) { self.window.handle(message) }
                self.receiveNext(on: task, connectionID: id)
            }
        }
    }

    private func finishSend(connectionID id: Int, failure: String?) {
        guard id == connectionID else { return }
        if let failure { return handleDrop(reason: failure) }
        window.didHandOffToTransport()
    }

    private func handleDrop(reason: String, closeCode: Int? = nil) {
        closeSocket()
        guard wantsConnection else { return publish(.idle) }
        if closeCode == RelayCloseCode.replacedByNewerSource {
            wantsConnection = false  // retrying would take the relay back from the new source, forever
            return publish(.stopped(reason: "Another depth source connected to the relay and took over. Tap Start to take it back."))
        }
        let delay = backoff.nextDelay()
        publish(.reconnecting(inSeconds: delay, reason: reason))
        let id = connectionID
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.wantsConnection, self.connectionID == id else { return }
            self.openSocket()
        }
    }

    /// 1 Hz: connect timeout, stalled-frame detection, keepalive pings, backoff reset after a stable link.
    private func tick() {
        let now = Self.now()
        switch state {
        case .connecting where now - stateSince > RelayLinkTiming.connectTimeout:
            handleDrop(reason: "Timed out connecting to the relay")
        case .connected:
            if let oldest = window.oldestUnconfirmedSince, now - oldest > RelayLinkTiming.sendStallTimeout {
                return handleDrop(reason: "Relay stopped accepting frames")
            }
            if now - stateSince > RelayLinkTiming.stableAfter { backoff.reset() }
            if now - lastPingAt >= RelayLinkTiming.pingInterval { sendPing() }
        default:
            break
        }
    }

    private func sendPing() {
        guard let task else { return }
        lastPingAt = Self.now()
        let id = connectionID
        task.sendPing { [weak self] error in
            guard let self, let error else { return }
            let reason = "Ping failed: \(error.localizedDescription)"
            self.queue.async {
                guard id == self.connectionID else { return }
                self.handleDrop(reason: reason)
            }
        }
    }

    private func publish(_ newState: RelayConnectionState) {
        stateSince = Self.now()  // refreshed even on repeats so a restarted connect gets a full timeout
        guard newState != state else { return }
        state = newState
        stateChanges.send(newState)
    }

    private static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
}
