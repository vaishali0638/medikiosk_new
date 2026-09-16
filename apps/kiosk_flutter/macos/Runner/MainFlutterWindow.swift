import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  private var audioGuidance: AudioGuidanceHandler?
  private var speechRecognition: SpeechRecognitionHandler?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

    // Spoken guidance, so the feature can be heard during development rather than only on
    // a kiosk. Retained on the window: the synthesiser must outlive this call.
    let audio = AudioGuidanceHandler()
    audioGuidance = audio
    FlutterMethodChannel(
      name: AudioGuidanceHandler.channelName,
      binaryMessenger: flutterViewController.engine.binaryMessenger
    ).setMethodCallHandler { call, result in audio.handle(call, result: result) }

    // Speech input. On-device only; see the handler for why it refuses rather than
    // falling back to Apple's servers.
    let speech = SpeechRecognitionHandler()
    speechRecognition = speech
    FlutterMethodChannel(
      name: SpeechRecognitionHandler.channelName,
      binaryMessenger: flutterViewController.engine.binaryMessenger
    ).setMethodCallHandler { call, result in speech.handle(call, result: result) }

    super.awakeFromNib()
  }
}
