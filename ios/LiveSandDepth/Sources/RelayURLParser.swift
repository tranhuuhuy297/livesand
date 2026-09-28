import Foundation

/// Normalizes whatever the pairing QR (or the user) provides into the relay's *source* WebSocket URL.
///
/// Accepts `ws(s)://host:port/ws?role=source`, a bare `host[:port]` (port defaults to 8787), a web-app page URL
/// that carries `?relay=<relay url>` or is served from the LAN by the relay itself, or the `/pairing.json` body
/// (`{"sourceUrls": [...]}`). Anything else, such as a public web page, a promo QR or `mailto:`, is rejected.
enum RelayURLParser {
    static let defaultRelayPort = 8787

    static func sourceURL(from raw: String) -> URL? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if text.hasPrefix("{") { return sourceURL(fromPairingJSON: text) }

        let hasScheme = text.contains("://")
        // Without a scheme only `host[:port][/path]` makes sense; this keeps `mailto:a@b` and prose out.
        if !hasScheme, text.range(of: #"^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?([/?].*)?$"#, options: .regularExpression) == nil {
            return nil
        }
        guard var components = URLComponents(string: hasScheme ? text : "ws://\(text)"),
              let scheme = components.scheme?.lowercased(),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil
        else { return nil }

        switch scheme {
        case "ws", "wss":
            components.scheme = scheme
            if components.path.isEmpty || components.path == "/" { components.path = "/ws" }
            // A typed IP alone would otherwise mean port 80, where no relay listens.
            if !hasScheme, components.port == nil { components.port = defaultRelayPort }
        case "http", "https":
            if let relay = components.queryItems?.first(where: { $0.name == "relay" })?.value {
                return sourceURL(from: relay)
            }
            // Only the relay's own page doubles as a relay address, and the relay lives on the LAN.
            guard isLocalNetworkHost(host) else { return nil }
            components.scheme = scheme == "https" ? "wss" : "ws"
            components.path = "/ws"
            components.queryItems = nil
        default:
            return nil
        }
        components.fragment = nil
        var items = (components.queryItems ?? []).filter { $0.name != "role" }
        items.append(URLQueryItem(name: "role", value: "source"))
        components.queryItems = items
        return components.url
    }

    /// Private/link-local/loopback IPs, `.local` mDNS names and single-label names: where `npx livesand` runs.
    static func isLocalNetworkHost(_ host: String) -> Bool {
        var name = host.lowercased()
        if name.hasPrefix("["), name.hasSuffix("]") { name = String(name.dropFirst().dropLast()) }
        if name.contains(":") {
            return name == "::1" || name.hasPrefix("fe80:") || name.hasPrefix("fc") || name.hasPrefix("fd")
        }
        let parts = name.split(separator: ".", omittingEmptySubsequences: false)
        let octets = parts.compactMap { UInt8($0) }
        if parts.count == 4, octets.count == 4 {
            switch (octets[0], octets[1]) {
            case (10, _), (127, _), (192, 168), (169, 254), (172, 16...31), (100, 64...127): return true
            default: return false
            }
        }
        return !name.contains(".") || name.hasSuffix(".local")
    }

    private static func sourceURL(fromPairingJSON json: String) -> URL? {
        guard let data = json.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let urls = object["sourceUrls"] as? [String]
        else { return nil }
        // Each candidate gets the same normalization (path /ws, role=source); first usable one wins.
        return urls.lazy.compactMap { sourceURL(from: $0) }.first
    }
}
