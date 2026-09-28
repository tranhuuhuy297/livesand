import AVFoundation

/// Camera authorization shared by the depth streamer (ARKit) and the QR scanner (AVFoundation).
enum CameraPermission {
    /// True when access is granted; prompts the user only the first time.
    static func requestIfNeeded() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}
