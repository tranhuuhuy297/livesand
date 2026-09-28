import AVFoundation
import SwiftUI
import UIKit

/// SwiftUI wrapper around an AVFoundation QR scanner. `onCode` returns true to accept a code (scanning stops).
struct QRCodeScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Bool

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ controller: QRScannerViewController, context: Context) {
        controller.onCode = onCode
    }
}

final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Bool)?

    private let captureSession = AVCaptureSession()
    // startRunning/stopRunning block for a noticeable time; keep them off the main thread.
    private let sessionQueue = DispatchQueue(label: "io.livesand.depth.qr-session")
    private let hintLabel = UILabel()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var isConfigured = false
    private var isVisible = false
    private var hasAcceptedCode = false
    private var lastRejectedCode: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setUpHintLabel()
        showHint("Point at the QR code in the LiveSand \u{201C}Connect iPhone\u{201D} panel.")
        Task { await prepareCamera() }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        isVisible = true
        if isConfigured { startRunning() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        isVisible = false
        stopRunning()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        // Keep the preview upright when the UI rotates to landscape.
        if let connection = previewLayer?.connection, connection.isVideoOrientationSupported,
           let interfaceOrientation = view.window?.windowScene?.interfaceOrientation,
           let videoOrientation = AVCaptureVideoOrientation(rawValue: interfaceOrientation.rawValue) {
            connection.videoOrientation = videoOrientation
        }
    }

    // MARK: - AVCaptureMetadataOutputObjectsDelegate (delivered on the main queue)

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection
    ) {
        let codes = metadataObjects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
        guard let code = codes.first else { return }
        Task { @MainActor [weak self] in self?.handle(code: code) }
    }

    // MARK: - Private

    private func prepareCamera() async {
        guard await CameraPermission.requestIfNeeded() else {
            showHint("Camera access is off. Enable it in Settings, or type the relay URL instead.")
            return
        }
        do {
            try configureSession()
        } catch {
            showHint("Camera unavailable: \(error.localizedDescription) Type the relay URL instead.")
            return
        }
        isConfigured = true
        if isVisible { startRunning() }
    }

    private func configureSession() throws {
        guard let device = AVCaptureDevice.default(for: .video) else { throw ScannerError.noCamera }
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureMetadataOutput()
        captureSession.beginConfiguration()
        defer { captureSession.commitConfiguration() }
        guard captureSession.canAddInput(input) else { throw ScannerError.cannotConfigure }
        captureSession.addInput(input)
        guard captureSession.canAddOutput(output) else { throw ScannerError.cannotConfigure }
        captureSession.addOutput(output)
        // Available types are only known once the output is attached to a session with an input.
        guard output.availableMetadataObjectTypes.contains(.qr) else { throw ScannerError.cannotConfigure }
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: captureSession)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
    }

    private func handle(code: String) {
        guard !hasAcceptedCode, code != lastRejectedCode else { return }
        if onCode?(code) == true {
            hasAcceptedCode = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            stopRunning()
        } else {
            lastRejectedCode = code  // the same code is reported every frame; complain once
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            showHint("That QR code is not a LiveSand relay link. Scan the one in \u{201C}Connect iPhone\u{201D}.")
        }
    }

    private func startRunning() {
        let session = captureSession
        sessionQueue.async {
            if !session.isRunning { session.startRunning() }
        }
    }

    private func stopRunning() {
        let session = captureSession
        sessionQueue.async {
            if session.isRunning { session.stopRunning() }
        }
    }

    private func setUpHintLabel() {
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        hintLabel.numberOfLines = 0
        hintLabel.textAlignment = .center
        hintLabel.textColor = .white
        hintLabel.font = .preferredFont(forTextStyle: .callout)
        hintLabel.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        hintLabel.layer.cornerRadius = 10
        hintLabel.layer.masksToBounds = true
        view.addSubview(hintLabel)
        NSLayoutConstraint.activate([
            hintLabel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            hintLabel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            hintLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
        ])
    }

    private func showHint(_ text: String) {
        hintLabel.text = "  \(text)  "
    }
}

private enum ScannerError: LocalizedError {
    case noCamera
    case cannotConfigure

    var errorDescription: String? {
        switch self {
        case .noCamera: return "No camera found."
        case .cannotConfigure: return "QR scanning is not supported by this camera."
        }
    }
}
