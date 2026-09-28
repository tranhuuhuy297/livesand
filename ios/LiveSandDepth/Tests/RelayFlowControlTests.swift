import XCTest
@testable import LiveSandDepth

final class RelayFlowControlTests: XCTestCase {
    func testParsesRelayControlMessages() {
        XCTAssertEqual(RelayControlMessage.parse(#"{"type":"hello","role":"source","acks":true}"#), .hello(acknowledgesFrames: true))
        XCTAssertEqual(RelayControlMessage.parse(#"{"type":"hello"}"#), .hello(acknowledgesFrames: false))
        XCTAssertEqual(RelayControlMessage.parse(#"{"type":"ack","frameIndex":41}"#), .frameAck)
        for text in ["", "ack", #"{"type":"status","sources":1}"#, "[1,2]"] {
            XCTAssertNil(RelayControlMessage.parse(text), text)
        }
    }

    func testOlderRelayPacesOnTransportHandOff() {
        var window = FrameSendWindow()
        XCTAssertTrue(window.canSend)
        window.didStartSend(at: 1)
        XCTAssertFalse(window.canSend)
        window.didHandOffToTransport()
        XCTAssertTrue(window.canSend)
        XCTAssertNil(window.oldestUnconfirmedSince)
    }

    func testAckingRelayKeepsAtMostTwoFramesUnconfirmed() {
        var window = FrameSendWindow()
        window.handle(.hello(acknowledgesFrames: true))
        window.didStartSend(at: 1)
        window.didStartSend(at: 2)
        XCTAssertFalse(window.canSend)
        window.didHandOffToTransport()  // the OS took the bytes, but the relay has not seen them yet
        window.didHandOffToTransport()
        XCTAssertFalse(window.canSend)
        XCTAssertEqual(window.oldestUnconfirmedSince, 1)
        window.handle(.frameAck)
        XCTAssertTrue(window.canSend)
        XCTAssertEqual(window.oldestUnconfirmedSince, 2)
        window.handle(.frameAck)
        window.handle(.frameAck)  // stray ack: never goes negative
        XCTAssertNil(window.oldestUnconfirmedSince)
        window.reset()
        XCTAssertFalse(window.relayAcknowledgesFrames)
    }

    func testReconnectBackoffDoublesToTheCapAndResets() {
        var backoff = ReconnectBackoff()
        XCTAssertEqual((0..<7).map { _ in backoff.nextDelay() }, [0.5, 1, 2, 4, 8, 10, 10])
        backoff.reset()
        XCTAssertEqual(backoff.nextDelay(), 0.5)
    }

    func testReplacedCloseCodeMatchesTheRelay() {
        XCTAssertEqual(RelayCloseCode.replacedByNewerSource, 4001)
    }
}
