/// Connection lifecycle shown in the UI.
enum RelayConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting(inSeconds: Double, reason: String)
}
