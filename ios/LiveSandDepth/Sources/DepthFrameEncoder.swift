import Foundation
#if canImport(CoreVideo)
import CoreVideo
#endif

/// Encodes depth maps into the LiveSand "LSD1" wire format shared with the relay and the browser.
///
/// Layout (little-endian): 0 u32 magic "LSD1" | 4 u16 version | 6 u16 format | 8 u32 width | 12 u32 height |
/// 16 f64 timestampMs | 24 u32 frameIndex | 28.. row-major payload (row 0 = top of the image).
enum DepthFrameEncoder {
    static let magic: UInt32 = 0x3144_534C  // bytes 'L','S','D','1' once written little-endian
    static let version: UInt16 = 1
    static let formatUInt16Millimeters: UInt16 = 2
    static let headerByteCount = 28

    enum EncodeError: LocalizedError, Equatable {
        case unsupportedPixelFormat(UInt32)
        case lockFailed(Int32)
        case missingBaseAddress
        case invalidLayout(width: Int, height: Int, bytesPerRow: Int)

        var errorDescription: String? {
            switch self {
            case .unsupportedPixelFormat(let format):
                return "Depth map pixel format \(format) is not DepthFloat32."
            case .lockFailed(let status):
                return "Could not lock the depth map (CVReturn \(status))."
            case .missingBaseAddress:
                return "Depth map has no readable memory."
            case let .invalidLayout(width, height, bytesPerRow):
                return "Unexpected depth map layout \(width)x\(height), \(bytesPerRow) bytes per row."
            }
        }
    }

    /// Converts meters to millimeters; NaN, non-positive and > 65.535 m samples become 0 (= invalid on the wire).
    @inline(__always)
    static func millimeters(fromMeters meters: Float32) -> UInt16 {
        let mm = (meters * 1000).rounded()
        // NaN fails both comparisons, so it lands in the invalid branch too.
        guard mm >= 1, mm <= 65_535 else { return 0 }
        return UInt16(mm)
    }

    /// The 28-byte LSD1 header for a uint16-millimeter frame.
    static func header(width: Int, height: Int, timestampMs: Double, frameIndex: UInt32) -> Data {
        var data = Data(capacity: headerByteCount + width * height * MemoryLayout<UInt16>.size)
        appendLittleEndian(magic, to: &data)
        appendLittleEndian(version, to: &data)
        appendLittleEndian(formatUInt16Millimeters, to: &data)
        appendLittleEndian(UInt32(truncatingIfNeeded: width), to: &data)
        appendLittleEndian(UInt32(truncatingIfNeeded: height), to: &data)
        appendLittleEndian(timestampMs.bitPattern, to: &data)
        appendLittleEndian(frameIndex, to: &data)
        return data
    }

    /// Encodes Float32 meter rows (`bytesPerRow` apart, row 0 = top) as a complete LSD1 uint16-mm frame.
    static func encodeFrame(
        metersBase: UnsafeRawPointer, width: Int, height: Int, bytesPerRow: Int,
        timestampMs: Double, frameIndex: UInt32
    ) throws -> Data {
        guard width > 0, height > 0, bytesPerRow >= width * MemoryLayout<Float32>.stride else {
            throw EncodeError.invalidLayout(width: width, height: height, bytesPerRow: bytesPerRow)
        }
        var data = header(width: width, height: height, timestampMs: timestampMs, frameIndex: frameIndex)
        data.count = headerByteCount + width * height * MemoryLayout<UInt16>.size  // zero-filled payload
        data.withUnsafeMutableBytes { (out: UnsafeMutableRawBufferPointer) in
            var offset = headerByteCount
            for y in 0..<height {
                let row = metersBase.advanced(by: y * bytesPerRow).assumingMemoryBound(to: Float32.self)
                for x in 0..<width {
                    out.storeBytes(of: millimeters(fromMeters: row[x]).littleEndian, toByteOffset: offset, as: UInt16.self)
                    offset += MemoryLayout<UInt16>.size
                }
            }
        }
        return data
    }

    private static func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            data.append(contentsOf: bytes)
        }
    }
}

#if canImport(CoreVideo)
extension DepthFrameEncoder {
    /// Encodes an ARKit depth map (kCVPixelFormatType_DepthFloat32, meters) as-is in sensor orientation.
    static func encode(depthMap: CVPixelBuffer, timestampMs: Double, frameIndex: UInt32) throws -> Data {
        let pixelFormat = CVPixelBufferGetPixelFormatType(depthMap)
        guard pixelFormat == kCVPixelFormatType_DepthFloat32 else {
            throw EncodeError.unsupportedPixelFormat(pixelFormat)
        }
        let lockStatus = CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        guard lockStatus == kCVReturnSuccess else { throw EncodeError.lockFailed(lockStatus) }
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(depthMap) else { throw EncodeError.missingBaseAddress }
        return try encodeFrame(
            metersBase: UnsafeRawPointer(base),
            width: CVPixelBufferGetWidth(depthMap),
            height: CVPixelBufferGetHeight(depthMap),
            bytesPerRow: CVPixelBufferGetBytesPerRow(depthMap),
            timestampMs: timestampMs,
            frameIndex: frameIndex
        )
    }
}
#endif
