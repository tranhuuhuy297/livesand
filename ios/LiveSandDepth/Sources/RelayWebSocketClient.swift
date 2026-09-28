import Combine
import Foundation

/// Streams binary frames to the relay over one WebSocket: at most one send in flight, auto-reconnect with backoff.
///
/// Thread-safety: every mutable property is confined to `queue`; public methods hop onto it.
final class RelayWebSocketClient: @unchecked Sendable {
    /// Emits on the client's private queue; subscribers should `receive(on:)` their own scheduler.
    let stateChanges = PassthroughSubject<RelayConnectionState, Never>()

    private let queue: DispatchQueue
    private let watchdog: DispatchSourceTimer
    private let initialBackoff: TimeInterval = 0.5
    private let maxBackoff: TimeInterval = 10
    private let connectTimeout: TimeInterval = 8
    private let sendStallTimeout: TimeInterval = 5
    private let pingInterval: TimeInterval = 5

    private var url: URL?
    private var wantsConnection = false
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var connectionID = 0  // bumped on every open/close so late callbacks from old sockets are ignored
    private var state: RelayConnectionState = .idle
    private var stateSince: TimeInterval = 0
    private var reconnectAttempt = 0
    private var sendInFlight = false
    private var sendStartedAt: TimeInterval = 0
    private var lastPingAt: TimeInterval = 0

    init() {
        let queue = DispatchQueue(label: "io.livesand.depth.relay", qos: .userInitiated)
        self.queue = queue
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
            self.reconnectAttempt = 0
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
        queue.sync { state == .connected && !sendInFlight }
    }

    /// Sends one binary message; returns false (frame dropped) when not connected or a send is still in flight.
    func send(_ frame: Data) -> Bool {
        queue.sync { () -> Bool in
            guard state == .connected, !sendInFlight, let task else { return false }
            sendInFlight = true
            sendStartedAt = Self.now()
            let id = connectionID
            task.send(.data(frame)) { [weak self] error in
                guard let self else { return }
                let failure = error?.localizedDescription
                self.queue.async { self.finishSend(connectionID: id, failure: failure) }
            }
            return true
        }
    }

    // MARK: - Socket lifecycle (from RelaySocketDelegateProxy, any thread)

    func socketDidOpen(_ socket: URLSessionTask) {
        queue.async {
            guard socket === self.task else { return }
            self.publish(.connected)
        }
    }

    func socketDidEnd(_ socket: URLSessionTask, reason: String) {
        queue.async {
            guard socket === self.task else { return }
            self.handleDrop(reason: reason)
        }
    }

    // MARK: - Queue-confined internals

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
        sendInFlight = false
        task?.cancel(with: .goingAway, reason: nil)
        session?.finishTasksAndInvalidate()  // one session per connection; invalidation frees its delegate
        task = nil
        session = nil
    }

    /// Sources never expect messages, but a pending receive is what surfaces a closed/broken socket.
    private func receiveNext(on task: URLSessionWebSocketTask, connectionID id: Int) {
        task.receive { [weak self] result in
            guard let self else { return }
            let reason: String?
            if case .failure(let error) = result { reason = error.localizedDescription } else { reason = nil }
            self.queue.async {
                guard id == self.connectionID else { return }
                if let reason { self.handleDrop(reason: reason) } else { self.receiveNext(on: task, connectionID: id) }
            }
        }
    }

    private func finishSend(connectionID id: Int, failure: String?) {
        guard id == connectionID else { return }
        sendInFlight = false
        if let failure { handleDrop(reason: failure) }
    }

    private func handleDrop(reason: String) {
        closeSocket()
        guard wantsConnection else { return publish(.idle) }
        let delay = min(maxBackoff, initialBackoff * pow(2, Double(reconnectAttempt)))
        reconnectAttempt = min(reconnectAttempt + 1, 10)
        publish(.reconnecting(inSeconds: delay, reason: reason))
        let id = connectionID
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.wantsConnection, self.connectionID == id else { return }
            self.openSocket()
        }
    }

    /// 1 Hz: connect timeout, stalled-send detection, keepalive pings, backoff reset after a stable link.
    private func tick() {
        let now = Self.now()
        switch state {
        case .connecting where now - stateSince > connectTimeout:
            handleDrop(reason: "Timed out connecting to the relay")
        case .connected:
            if sendInFlight, now - sendStartedAt > sendStallTimeout {
                handleDrop(reason: "Relay stopped accepting frames")
                return
            }
            if now - stateSince > 5 { reconnectAttempt = 0 }
            if now - lastPingAt >= pingInterval { sendPing() }
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
