import XCTest
@testable import LiveSandDepth

final class RelayURLParserTests: XCTestCase {
    private func parse(_ text: String) -> String? {
        RelayURLParser.sourceURL(from: text)?.absoluteString
    }

    func testCanonicalSourceURLIsUnchanged() {
        XCTAssertEqual(parse("ws://192.168.1.5:8787/ws?role=source"), "ws://192.168.1.5:8787/ws?role=source")
    }

    func testBareHostAndPortGetSchemePathAndRole() {
        XCTAssertEqual(parse("  192.168.1.5:8787 "), "ws://192.168.1.5:8787/ws?role=source")
    }

    func testViewerRoleIsRewrittenToSource() {
        XCTAssertEqual(parse("ws://192.168.1.5:8787/ws?role=viewer"), "ws://192.168.1.5:8787/ws?role=source")
    }

    func testCustomPathAndQueryArePreserved() {
        XCTAssertEqual(
            parse("WSS://relay.example:443/custom/ws?token=abc"),
            "wss://relay.example:443/custom/ws?token=abc&role=source"
        )
    }

    func testWebAppPageURLMapsToTheSameHostRelay() {
        XCTAssertEqual(parse("http://192.168.1.5:8787/?mode=projector"), "ws://192.168.1.5:8787/ws?role=source")
    }

    func testWebAppRelayParamWins() {
        XCTAssertEqual(
            parse("https://user.github.io/livesand/?relay=ws://10.0.0.2:8787/ws%3Frole%3Dviewer"),
            "ws://10.0.0.2:8787/ws?role=source"
        )
    }

    func testPairingJSONUsesFirstSourceURL() {
        let json = #"{"sourceUrls":["ws://10.0.0.9:8787/ws?role=source"],"viewerUrls":[],"port":8787}"#
        XCTAssertEqual(parse(json), "ws://10.0.0.9:8787/ws?role=source")
    }

    func testRejectsUnusableInput() {
        for text in ["", "hello world", "ftp://host/path", "{not json"] {
            XCTAssertNil(parse(text), text)
        }
    }
}
