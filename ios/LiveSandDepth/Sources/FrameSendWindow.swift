import Foundation

/// Flow control for depth frames: how many are still unconfirmed, and since when.
///
/// A send completion only means the OS took the bytes; on slow Wi-Fi the kernel buffer then hides seconds of
/// latency. Relays that ack each frame let us count frames the relay actually received instead.
struct FrameSendWindow {
    /// Two frames in flight keep a LAN link busy without letting a queue of stale frames form.
    static let maxUnackedFrames = 2

    private(set) var relayAcknowledgesFrames = false
    private var unconfirmedSince: [TimeInterval] = []  // send start times, oldest first

    var canSend: Bool { unconfirmedSince.count < (relayAcknowledgesFrames ? Self.maxUnackedFrames : 1) }

    /// Start time of the oldest frame the relay has not confirmed yet.
    var oldestUnconfirmedSince: TimeInterval? { unconfirmedSince.first }

    mutating func didStartSend(at time: TimeInterval) {
        unconfirmedSince.append(time)
    }

    /// Transport accepted the frame: the only confirmation an older relay (no acks) will ever give.
    mutating func didHandOffToTransport() {
        if !relayAcknowledgesFrames { confirmOldest() }
    }

    /// The relay's hello switches pacing to acks; each ack confirms the oldest frame (TCP keeps them in order).
    mutating func handle(_ message: RelayControlMessage) {
        switch message {
        case .hello(let acknowledgesFrames): if acknowledgesFrames { relayAcknowledgesFrames = true }
        case .frameAck: confirmOldest()
        }
    }

    mutating func reset() {
        relayAcknowledgesFrames = false
        unconfirmedSince.removeAll()
    }

    private mutating func confirmOldest() {
        if !unconfirmedSince.isEmpty { unconfirmedSince.removeFirst() }
    }
}
