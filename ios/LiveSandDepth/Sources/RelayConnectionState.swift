/// Connection lifecycle shown in the UI.
enum RelayConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting(inSeconds: Double, reason: String)
    /// The relay ended the session in a way retrying cannot fix (e.g. another source took over).
    case stopped(reason: String)
}
