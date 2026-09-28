import Foundation

/// Timeouts of the relay link, in seconds.
enum RelayLinkTiming {
    static let connectTimeout: TimeInterval = 8
    /// A frame unconfirmed this long means the relay (or the Wi-Fi) stopped taking frames.
    static let sendStallTimeout: TimeInterval = 5
    static let pingInterval: TimeInterval = 5
    /// Connected this long counts as stable, so the next drop retries quickly again.
    static let stableAfter: TimeInterval = 5
}

/// Reconnect delay: 0.5 s doubling up to 10 s, reset once a link has proved stable.
struct ReconnectBackoff {
    static let initialDelay: TimeInterval = 0.5
    static let maxDelay: TimeInterval = 10

    private var attempt = 0

    mutating func nextDelay() -> TimeInterval {
        let delay = min(Self.maxDelay, Self.initialDelay * pow(2, Double(attempt)))
        attempt = min(attempt + 1, 10)
        return delay
    }

    mutating func reset() {
        attempt = 0
    }
}
