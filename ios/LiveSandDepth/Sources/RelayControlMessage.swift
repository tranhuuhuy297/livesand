import Foundation

/// Close codes the relay uses for decisions a source must not retry against.
enum RelayCloseCode {
    /// A newer depth source connected; reconnecting would just take the relay back and forth between the two.
    static let replacedByNewerSource = 4001
}

/// Text messages the relay sends to a depth source (`{"type": ...}` JSON).
enum RelayControlMessage: Equatable {
    /// Sent on connect; `acknowledgesFrames` means one `frameAck` follows every binary message.
    case hello(acknowledgesFrames: Bool)
    case frameAck

    static func parse(_ text: String) -> RelayControlMessage? {
        guard let data = text.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = object["type"] as? String
        else { return nil }
        switch type {
        case "hello": return .hello(acknowledgesFrames: (object["acks"] as? Bool) ?? false)
        case "ack": return .frameAck
        default: return nil
        }
    }
}
