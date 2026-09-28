import XCTest
@testable import LiveSandDepth

final class DepthFrameEncoderTests: XCTestCase {
    func testMillimeterConversionMarksInvalidSamplesAsZero() {
        XCTAssertEqual(DepthFrameEncoder.millimeters(fromMeters: 1.2345), 1235)
        XCTAssertEqual(DepthFrameEncoder.millimeters(fromMeters: 65.535), 65_535)
        let invalid: [Float32] = [.nan, .infinity, -1, 0, 0.0004, 70]
        for meters in invalid {
            XCTAssertEqual(DepthFrameEncoder.millimeters(fromMeters: meters), 0, "\(meters) m")
        }
    }

    func testHeaderMatchesLSD1WireLayout() {
        let header = Array(DepthFrameEncoder.header(width: 256, height: 192, timestampMs: 1234.5, frameIndex: 7))
        XCTAssertEqual(header.count, DepthFrameEncoder.headerByteCount)
        XCTAssertEqual(Array(header[0..<4]), Array("LSD1".utf8))
        XCTAssertEqual(Array(header[4..<8]), [1, 0, 2, 0])  // version 1, format 2 (uint16 mm)
        XCTAssertEqual(Array(header[8..<16]), [0, 1, 0, 0, 192, 0, 0, 0])  // width 256, height 192
        let timestampBits = (0..<8).reduce(UInt64(0)) { bits, i in bits | UInt64(header[16 + i]) << UInt64(8 * i) }
        XCTAssertEqual(Double(bitPattern: timestampBits), 1234.5)
        XCTAssertEqual(Array(header[24..<28]), [7, 0, 0, 0])
    }

    func testPayloadHonorsRowStrideAndKeepsRowZeroFirst() throws {
        let bytesPerRow = 20  // 3 floats + 8 bytes of padding, like CVPixelBuffer row alignment
        let meters: [[Float32]] = [[1.0, .nan, 0.25], [70, -1, 1.5]]
        var raw = [UInt8](repeating: 0xFF, count: bytesPerRow * meters.count)
        raw.withUnsafeMutableBytes { buffer in
            for (y, row) in meters.enumerated() {
                for (x, value) in row.enumerated() {
                    buffer.storeBytes(of: value, toByteOffset: y * bytesPerRow + x * 4, as: Float32.self)
                }
            }
        }
        let frame = try raw.withUnsafeBytes { buffer in
            try DepthFrameEncoder.encodeFrame(
                metersBase: buffer.baseAddress!, width: 3, height: 2, bytesPerRow: bytesPerRow,
                timestampMs: 0, frameIndex: 0
            )
        }
        let payload = Array(frame.dropFirst(DepthFrameEncoder.headerByteCount))
        let samples = stride(from: 0, to: payload.count, by: 2).map { UInt16(payload[$0]) | UInt16(payload[$0 + 1]) << 8 }
        XCTAssertEqual(samples, [1000, 0, 250, 0, 0, 1500])
    }

    func testRejectsRowsShorterThanWidth() {
        let raw = [UInt8](repeating: 0, count: 64)
        XCTAssertThrowsError(try raw.withUnsafeBytes { buffer in
            try DepthFrameEncoder.encodeFrame(
                metersBase: buffer.baseAddress!, width: 6, height: 2, bytesPerRow: 20, timestampMs: 0, frameIndex: 0
            )
        })
    }
}
