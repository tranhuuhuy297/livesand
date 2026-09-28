import Foundation

/// Normalizes whatever the pairing QR (or the user) provides into the relay's *source* WebSocket URL.
///
/// Accepts `ws(s)://host:port/ws?role=source`, a bare `host:port`, the web-app page URL (`http(s)://…`,
/// optionally carrying `?relay=<ws url>`), or the `/pairing.json` body (`{"sourceUrls": [...]}`).
enum RelayURLParser {
    static func sourceURL(from raw: String) -> URL? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if text.hasPrefix("{") { return sourceURL(fromPairingJSON: text) }

        let withScheme = text.contains("://") ? text : "ws://\(text)"
        guard var components = URLComponents(string: withScheme),
              let scheme = components.scheme?.lowercased(),
              let host = components.host, !host.isEmpty
        else { return nil }

        switch scheme {
        case "ws", "wss":
            components.scheme = scheme
            if components.path.isEmpty || components.path == "/" { components.path = "/ws" }
        case "http", "https":
            // A web-app link: prefer its explicit relay param, else the relay serves page + socket on one port.
            if let relay = components.queryItems?.first(where: { $0.name == "relay" })?.value,
               relay.lowercased().hasPrefix("ws") {
                return sourceURL(from: relay)
            }
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

    private static func sourceURL(fromPairingJSON json: String) -> URL? {
        guard let data = json.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let urls = object["sourceUrls"] as? [String]
        else { return nil }
        // Each candidate gets the same normalization (path /ws, role=source); first usable one wins.
        return urls.lazy.compactMap { sourceURL(from: $0) }.first
    }
}
