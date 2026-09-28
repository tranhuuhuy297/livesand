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

    func testBareHostWithoutPortUsesTheRelayDefaultPort() {
        XCTAssertEqual(parse("192.168.1.5"), "ws://192.168.1.5:8787/ws?role=source")
        XCTAssertEqual(parse("mymac.local"), "ws://mymac.local:8787/ws?role=source")
        XCTAssertEqual(parse("ws://192.168.1.5/ws"), "ws://192.168.1.5/ws?role=source")  // explicit scheme: taken as typed
    }

    func testRejectsWebPagesThatAreNotTheRelay() {
        for text in [
            "https://example.com/promo?utm=qr",
            "https://tranhuuhuy297.github.io/livesand/",
            "http://8.8.8.8:8787/",
            "mailto:someone@example.com",
            "ws://user:secret@192.168.1.5:8787/ws",
            "tel:+15551234567",
        ] {
            XCTAssertNil(parse(text), text)
        }
    }

    func testAcceptsTheRelayPageOnTheLAN() {
        XCTAssertEqual(parse("http://10.0.0.4:8787/?mode=projector"), "ws://10.0.0.4:8787/ws?role=source")
        XCTAssertEqual(parse("http://172.20.4.17:8787/"), "ws://172.20.4.17:8787/ws?role=source")
        XCTAssertEqual(parse("http://mymac:8787/"), "ws://mymac:8787/ws?role=source")
        XCTAssertEqual(parse("https://me.github.io/livesand/?relay=10.0.0.2:8787"), "ws://10.0.0.2:8787/ws?role=source")
    }

    func testLocalNetworkHostClassification() {
        for host in ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.0.9", "169.254.1.1", "127.0.0.1", "[fe80::1]", "fd12::3", "mymac", "nas.local"] {
            XCTAssertTrue(RelayURLParser.isLocalNetworkHost(host), host)
        }
        for host in ["172.32.0.1", "8.8.8.8", "example.com", "me.github.io", "2001:db8::1", "300.1.1.1"] {
            XCTAssertFalse(RelayURLParser.isLocalNetworkHost(host), host)
        }
    }
}
