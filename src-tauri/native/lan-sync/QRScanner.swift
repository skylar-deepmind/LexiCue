#if os(iOS)
  import AVFoundation
  import UIKit

  /// A native camera sheet scoped to one explicit pairing attempt.
  final class PairingScanner: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let capture = DispatchQueue(label: "lexicue.device-sync.camera")
    private let reply: (Result<PairingOffer, ScannerError>) -> Void
    private var finished = false
    private var preview: AVCaptureVideoPreviewLayer?
    enum ScannerError: Error { case denied, unavailable, invalid, canceled }

    init(reply: @escaping (Result<PairingOffer, ScannerError>) -> Void) {
      self.reply = reply
      super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { nil }

    static func present(reply: @escaping (Result<PairingOffer, ScannerError>) -> Void)
      -> PairingScanner?
    {
      guard
        let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
          .first(where: { $0.activationState == .foregroundActive }),
        var host = scene.windows.first(where: \.isKeyWindow)?.rootViewController
      else {
        reply(.failure(.unavailable))
        return nil
      }
      while let next = host.presentedViewController { host = next }
      let scanner = PairingScanner(reply: reply)
      let navigation = UINavigationController(rootViewController: scanner)
      navigation.modalPresentationStyle = .fullScreen
      host.present(navigation, animated: true)
      return scanner
    }

    override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .black
      navigationItem.leftBarButtonItem = UIBarButtonItem(
        barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
      let layer = AVCaptureVideoPreviewLayer(session: session)
      layer.videoGravity = .resizeAspectFill
      view.layer.addSublayer(layer)
      preview = layer
      AVCaptureDevice.requestAccess(for: .video) { allowed in
        DispatchQueue.main.async {
          guard !self.finished else { return }
          guard allowed else {
            self.finish(.failure(.denied))
            return
          }
          self.startCapture()
        }
      }
    }

    private func startCapture() {
      capture.async {
        guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device), self.session.canAddInput(input)
        else {
          DispatchQueue.main.async { self.finish(.failure(.unavailable)) }
          return
        }
        self.session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard self.session.canAddOutput(output) else {
          DispatchQueue.main.async { self.finish(.failure(.unavailable)) }
          return
        }
        self.session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        guard output.availableMetadataObjectTypes.contains(.qr) else {
          DispatchQueue.main.async { self.finish(.failure(.unavailable)) }
          return
        }
        output.metadataObjectTypes = [.qr]
        self.session.startRunning()
      }
    }

    override func viewDidLayoutSubviews() {
      super.viewDidLayoutSubviews()
      preview?.frame = view.bounds
      if let orientation = view.window?.windowScene?.interfaceOrientation,
        let captureOrientation = AVCaptureVideoOrientation(rawValue: orientation.rawValue),
        preview?.connection?.isVideoOrientationSupported == true
      {
        preview?.connection?.videoOrientation = captureOrientation
      }
    }

    override var keyCommands: [UIKeyCommand]? {
      [UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(cancel))]
    }

    func metadataOutput(
      _ output: AVCaptureMetadataOutput, didOutput items: [AVMetadataObject],
      from connection: AVCaptureConnection
    ) {
      guard let text = (items.first as? AVMetadataMachineReadableCodeObject)?.stringValue else {
        return
      }
      if let offer = try? PairingOffer.scan(text) {
        finish(.success(offer))
      } else {
        finish(.failure(.invalid))
      }
    }

    @objc func cancel() { finish(.failure(.canceled)) }

    private func finish(_ result: Result<PairingOffer, ScannerError>) {
      guard !finished else { return }
      finished = true
      capture.async { if self.session.isRunning { self.session.stopRunning() } }
      navigationController?.dismiss(animated: true)
      reply(result)
    }
  }
#endif
