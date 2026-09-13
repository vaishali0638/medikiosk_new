import 'package:flutter/material.dart';

import '../l10n/kiosk_strings.dart';
import '../theme/accessibility_settings.dart';
import '../theme/design_tokens.dart';
import '../widgets/mk_button.dart';
import '../widgets/mk_screen.dart';

/// Document categories, mirroring `DOCUMENT_TYPES` in the contracts.
enum DocumentKind {
  prescription('PRESCRIPTION', 'documents.prescription'),
  labReport('LAB_REPORT', 'documents.labReport'),
  dischargeSummary('DISCHARGE_SUMMARY', 'documents.dischargeSummary'),
  radiologyReport('RADIOLOGY_REPORT', 'documents.radiologyReport'),
  referral('REFERRAL', 'documents.referral'),
  other('OTHER', 'documents.other');

  const DocumentKind(this.wire, this.stringKey);

  final String wire;
  final String stringKey;
}

/// How a document reached the kiosk.
enum CaptureMethod { camera, scanner, file }

/// One document already attached to this visit.
@immutable
class AttachedDocument {
  const AttachedDocument({
    required this.id,
    required this.kind,
    required this.state,
    required this.extractionState,
  });

  final String id;
  final DocumentKind kind;

  /// `STORED`, `REJECTED_MALWARE`, `REJECTED_INVALID`.
  final String state;

  /// `PENDING`, `AWAITING_CLINICIAN_REVIEW`, `FAILED`, or null.
  final String? extractionState;

  bool get isStored => state == 'STORED';
}

/// "Add previous records" — the entry point.
///
/// "I have no documents" is a first-class option, not a way of skipping. Most patients at
/// a government OPD arrive with nothing, and a screen that treats that as an omission
/// makes them feel they have failed at something.
class AddDocumentsScreen extends StatelessWidget {
  const AddDocumentsScreen({
    required this.strings,
    required this.attached,
    required this.onCapture,
    required this.onNoDocuments,
    required this.onContinue,
    required this.onExit,
    this.cameraAvailable = false,
    this.scannerAvailable = false,
    this.fileImportAvailable = false,
    super.key,
  });

  final KioskStrings strings;
  final List<AttachedDocument> attached;
  final ValueChanged<CaptureMethod> onCapture;
  final VoidCallback onNoDocuments;
  final VoidCallback onContinue;
  final VoidCallback onExit;
  final bool cameraAvailable;
  final bool scannerAvailable;

  /// Off by default. A kiosk in lock-task mode has no file browser to pick from, so
  /// `Upload file` is only meaningful on a deployment that supplies one (a USB import
  /// surface, say). Rendering it unconditionally would put a button on the screen that
  /// opens nothing.
  final bool fileImportAvailable;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['documents.title'],
      subtitle: strings['documents.subtitle'],
      primaryAction: attached.isEmpty
          ? MkButton(
              label: strings['documents.noDocuments'],
              emphasis: MkButtonEmphasis.primary,
              onPressed: onNoDocuments,
            )
          : MkButton(
              label: strings['common.continue'],
              emphasis: MkButtonEmphasis.primary,
              onPressed: onContinue,
            ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // Only capture routes the hardware actually supports. A dead button on a kiosk
          // with no scanner sends patients to ask staff about something that will never
          // work here.
          if (cameraAvailable) ...<Widget>[
            MkButton(
              label: strings['documents.takePhoto'],
              icon: Icons.photo_camera_outlined,
              onPressed: () => onCapture(CaptureMethod.camera),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
          if (scannerAvailable) ...<Widget>[
            MkButton(
              label: strings['documents.useScanner'],
              icon: Icons.scanner_outlined,
              onPressed: () => onCapture(CaptureMethod.scanner),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
          if (fileImportAvailable) ...<Widget>[
            MkButton(
              label: strings['documents.uploadFile'],
              icon: Icons.upload_file_outlined,
              onPressed: () => onCapture(CaptureMethod.file),
            ),
            const SizedBox(height: MkSpacing.md),
          ],
          if (!cameraAvailable && !scannerAvailable && !fileImportAvailable)
            Text(
              strings['documents.captureUnavailable'],
              style: MkType.body.toTextStyle(
                color: MkColors.neutralText,
                scale: a11y.textScale,
              ),
            ),

          if (attached.isNotEmpty) ...<Widget>[
            const SizedBox(height: MkSpacing.lg),
            Text(
              '${strings['documents.attached']}: ${attached.length}',
              style: MkType.body.toTextStyle(
                color: MkColors.neutralText,
                scale: a11y.textScale,
              ),
            ),
            const SizedBox(height: MkSpacing.sm),
            for (final AttachedDocument doc in attached)
              Padding(
                padding: const EdgeInsets.only(bottom: MkSpacing.xs),
                child: Row(
                  children: <Widget>[
                    Icon(
                      doc.isStored ? Icons.check_circle_outline : Icons.info_outline,
                      size: 20,
                      color: doc.isStored ? MkColors.success : MkColors.mutedText,
                    ),
                    const SizedBox(width: MkSpacing.sm),
                    Expanded(
                      child: Text(
                        '${strings[doc.kind.stringKey]} — ${_stateLabel(doc)}',
                        style: MkType.caption.toTextStyle(
                          color: MkColors.mutedText,
                          scale: a11y.textScale,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: MkSpacing.md),
            // Never presented as read. The doctor verifies; the kiosk only says the
            // original is safe.
            Text(
              strings['documents.originalsSaved'],
              style: MkType.caption.toTextStyle(
                color: MkColors.mutedText,
                scale: a11y.textScale,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _stateLabel(AttachedDocument doc) {
    if (!doc.isStored) return strings['documents.notAccepted'];
    return switch (doc.extractionState) {
      'AWAITING_CLINICIAN_REVIEW' => strings['documents.readyForDoctor'],
      'FAILED' => strings['documents.savedNotRead'],
      _ => strings['documents.saved'],
    };
  }
}

/// Choosing what a captured document is.
class DocumentTypeScreen extends StatelessWidget {
  const DocumentTypeScreen({
    required this.strings,
    required this.onSelect,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;
  final ValueChanged<DocumentKind> onSelect;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return MkScreen(
      title: strings['documents.whatIsThis'],
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final DocumentKind kind in DocumentKind.values) ...<Widget>[
            MkButton(label: strings[kind.stringKey], onPressed: () => onSelect(kind)),
            const SizedBox(height: MkSpacing.md),
          ],
        ],
      ),
    );
  }
}

/// Shown when a captured image may be hard to read.
///
/// The specification is explicit that this screen offers no retry assistance and no staff
/// help — `Use this image` or `Exit`. So the warning is informational: it must not imply
/// the patient did something wrong, and using the image anyway has to be the easy path,
/// because a poor scan the doctor can squint at beats no scan at all.
class ImageQualityScreen extends StatelessWidget {
  const ImageQualityScreen({
    required this.strings,
    required this.problems,
    required this.onUseAnyway,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;

  /// String keys of the detected problems.
  final List<String> problems;

  final VoidCallback onUseAnyway;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);

    return MkScreen(
      title: strings['documents.qualityTitle'],
      primaryAction: MkButton(
        label: strings['documents.useThisImage'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: onUseAnyway,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            strings['documents.qualityBody'],
            style: MkType.body.toTextStyle(
              color: MkColors.neutralText,
              scale: a11y.textScale,
            ),
          ),
          const SizedBox(height: MkSpacing.md),
          for (final String problem in problems)
            Padding(
              padding: const EdgeInsets.only(bottom: MkSpacing.xs),
              child: Text(
                '•  ${strings[problem]}',
                style: MkType.body.toTextStyle(
                  color: MkColors.mutedText,
                  scale: a11y.textScale,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// What happened to each document, after upload.
///
/// The two sentences at the foot of this screen are the whole point of it. The kiosk has
/// just run text extraction over a patient's prescriptions, and it would be very easy to
/// show them what it read — which would invite the patient to correct it, argue with it,
/// or believe it. It shows neither the extracted text nor any confidence number: the
/// original is safe, and a clinician verifies what was read from it. Nothing on this
/// screen is a clinical finding.
class OcrStatusScreen extends StatelessWidget {
  const OcrStatusScreen({
    required this.strings,
    required this.attached,
    required this.onContinue,
    required this.onExit,
    super.key,
  });

  final KioskStrings strings;
  final List<AttachedDocument> attached;
  final VoidCallback onContinue;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    final AccessibilitySettings a11y = AccessibilityScope.of(context);
    final List<AttachedDocument> stored =
        attached.where((AttachedDocument d) => d.isStored).toList(growable: false);

    return MkScreen(
      title: '${strings['documents.uploadedCount']}: ${stored.length}',
      // Continue is always live. Extraction runs asynchronously and must never hold up a
      // token — a patient whose OCR is still queued waits for nothing.
      primaryAction: MkButton(
        label: strings['common.continue'],
        emphasis: MkButtonEmphasis.primary,
        onPressed: onContinue,
      ),
      exitAction: MkButton(
        label: strings['common.exit'],
        emphasis: MkButtonEmphasis.quiet,
        onPressed: onExit,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (int i = 0; i < stored.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: MkSpacing.sm),
              child: Text(
                '${i + 1}. ${strings[stored[i].kind.stringKey]} — ${_extractionLabel(stored[i])}',
                style: MkType.body.toTextStyle(
                  color: MkColors.neutralText,
                  scale: a11y.textScale,
                ),
              ),
            ),
          const SizedBox(height: MkSpacing.lg),
          Container(
            padding: const EdgeInsets.all(MkSpacing.md),
            decoration: BoxDecoration(
              color: MkColors.lightOrange,
              borderRadius: BorderRadius.circular(MkRadius.md),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  strings['documents.originalsSaved'],
                  style: MkType.body.toTextStyle(
                    color: MkColors.neutralText,
                    scale: a11y.textScale,
                  ),
                ),
                const SizedBox(height: MkSpacing.xs),
                Text(
                  strings['documents.doctorMustVerify'],
                  style: MkType.body.toTextStyle(
                    color: MkColors.neutralText,
                    scale: a11y.textScale,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _extractionLabel(AttachedDocument doc) {
    return switch (doc.extractionState) {
      'PENDING' => strings['documents.ocrProcessing'],
      'AWAITING_CLINICIAN_REVIEW' => strings['documents.readyForDoctor'],
      // A failed extraction is not the patient's problem and is not an error state for
      // them: the document itself is stored and the doctor will read it directly.
      'FAILED' => strings['documents.savedNotRead'],
      _ => strings['documents.uploaded'],
    };
  }
}
