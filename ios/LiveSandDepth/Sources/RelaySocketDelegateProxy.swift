import Foundation

/// URLSession retains its delegate strongly; this proxy forwards socket lifecycle events without retaining the client.
final class RelaySocketDelegateProxy: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private weak var client: RelayWebSocketClient?  // written once in init, then only read

    init(client: RelayWebSocketClient) {
        self.client = client
        super.init()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol negotiatedProtocol: String?) {
        client?.socketDidOpen(webSocketTask)
    }

    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        client?.socketDidEnd(webSocketTask, reason: "Relay closed the connection (code \(closeCode.rawValue))")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        client?.socketDidEnd(task, reason: error?.localizedDescription ?? "Connection ended")
    }
}
