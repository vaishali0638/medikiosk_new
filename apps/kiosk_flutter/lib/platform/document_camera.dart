import 'package:flutter/foundation.dart';

/// A captured page.
@immutable
class CapturedDocument {
  const CapturedDocument({
    required this.bytes,
    required this.contentType,
    this.qualityProblems = const <String>[],
  });

  final Uint8List bytes;
  final String contentType;

  /// String keys of detected problems: blur, glare, a missing edge. Empty when the
  /// capture looks readable, or when nothing analysed it.
  final List<String> qualityProblems;
}

/// Captures a photograph or scan of a patient's paper records.
///
/// Separate from [QrScanner] even though both use a camera. A QR scan reads a code and
/// discards the frame; a document capture keeps the image, which is patient clinical
/// material and has to be wiped with the rest of the session. Sharing one interface would
/// make it easy to forget which of the two was holding a photograph of a prescription.
abstract class DocumentCamera {
  Future<bool> isAvailable();

  /// Returns null when the patient cancelled or no camera answered.
  Future<CapturedDocument?> capture();

  /// Releases the camera and discards any retained frames.
  Future<void> stop();
}

/// The default on every platform where no capture hardware is wired up.
///
/// Reports unavailable rather than throwing, so the kiosk renders "documents cannot be
/// added at this kiosk" — which is true, and leaves the patient a working journey — rather
/// than offering a button that fails when pressed.
class UnavailableDocumentCamera implements DocumentCamera {
  const UnavailableDocumentCamera();

  @override
  Future<bool> isAvailable() async => false;

  @override
  Future<CapturedDocument?> capture() async => null;

  @override
  Future<void> stop() async {}
}
