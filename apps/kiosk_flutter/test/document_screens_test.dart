import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/screens/document_screens.dart';
import 'package:medikiosk_kiosk/widgets/mk_button.dart';

import 'support/widget_host.dart';

void main() {
  final KioskStrings strings = KioskStrings.of('en');

  AttachedDocument doc({
    String id = 'doc-1',
    DocumentKind kind = DocumentKind.labReport,
    String state = 'STORED',
    String? extraction = 'PENDING',
  }) {
    return AttachedDocument(id: id, kind: kind, state: state, extractionState: extraction);
  }

  Future<void> pumpAdd(
    WidgetTester tester, {
    List<AttachedDocument> attached = const <AttachedDocument>[],
    bool camera = true,
    bool scanner = false,
    bool fileImport = false,
    ValueChanged<CaptureMethod>? onCapture,
    VoidCallback? onNoDocuments,
    VoidCallback? onContinue,
  }) {
    return tester.pumpWidget(
      host(
        AddDocumentsScreen(
          strings: strings,
          attached: attached,
          cameraAvailable: camera,
          scannerAvailable: scanner,
          fileImportAvailable: fileImport,
          onCapture: onCapture ?? (_) {},
          onNoDocuments: onNoDocuments ?? () {},
          onContinue: onContinue ?? () {},
          onExit: () {},
        ),
      ),
    );
  }

  group('add previous records', () {
    testWidgets('offers only the capture routes the hardware supports', (
      WidgetTester tester,
    ) async {
      await pumpAdd(tester, camera: true, scanner: false, fileImport: false);

      expect(find.text('Take a photo'), findsOneWidget);
      // A scanner button on a kiosk with no scanner sends the patient to look for staff.
      expect(find.text('Use scanner'), findsNothing);
      expect(find.text('Upload file'), findsNothing);
    });

    testWidgets('says so plainly when no capture route exists', (WidgetTester tester) async {
      await pumpAdd(tester, camera: false);

      expect(
        find.text('Documents cannot be added at this kiosk. You can show them to the doctor.'),
        findsOneWidget,
      );
      // Still not a dead end: the patient can decline documents and carry on.
      expect(find.text('I have no documents'), findsOneWidget);
    });

    testWidgets('"I have no documents" is a first-class choice, not a skip', (
      WidgetTester tester,
    ) async {
      bool declared = false;
      await pumpAdd(tester, onNoDocuments: () => declared = true);

      final MkButton button = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'I have no documents'),
      );
      expect(button.emphasis, MkButtonEmphasis.primary);

      await tester.tap(find.text('I have no documents'));
      expect(declared, isTrue);
    });

    testWidgets('once a document is attached, Continue is the primary action', (
      WidgetTester tester,
    ) async {
      await pumpAdd(tester, attached: <AttachedDocument>[doc()]);

      expect(find.text('I have no documents'), findsNothing);
      final MkButton button = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'Continue'),
      );
      expect(button.emphasis, MkButtonEmphasis.primary);
    });

    testWidgets('a rejected document is reported without saying why', (
      WidgetTester tester,
    ) async {
      await pumpAdd(
        tester,
        attached: <AttachedDocument>[
          doc(state: 'REJECTED_MALWARE', extraction: null),
        ],
      );

      expect(find.textContaining('not accepted'), findsOneWidget);
      // The reason is an operational detail. Telling a patient their prescription photo
      // "contains malware" is frightening and useless: they cannot act on it.
      expect(find.textContaining('malware', findRichText: true), findsNothing);
      expect(find.textContaining('MALWARE'), findsNothing);
      expect(find.textContaining('virus'), findsNothing);
    });

    testWidgets('exit is always reachable', (WidgetTester tester) async {
      await pumpAdd(tester);
      expect(find.text('Exit'), findsOneWidget);
    });
  });

  group('document type', () {
    testWidgets('offers every type and nothing else', (WidgetTester tester) async {
      DocumentKind? chosen;
      await tester.pumpWidget(
        host(
          DocumentTypeScreen(
            strings: strings,
            onSelect: (DocumentKind k) => chosen = k,
            onExit: () {},
          ),
        ),
      );

      for (final DocumentKind kind in DocumentKind.values) {
        expect(find.text(strings[kind.stringKey]), findsOneWidget);
      }

      await tester.tap(find.text('Discharge summary'));
      expect(chosen, DocumentKind.dischargeSummary);
    });
  });

  group('image quality', () {
    Future<void> pumpQuality(
      WidgetTester tester, {
      VoidCallback? onUseAnyway,
    }) {
      return tester.pumpWidget(
        host(
          ImageQualityScreen(
            strings: strings,
            problems: const <String>[
              'documents.quality.blurry',
              'documents.quality.glare',
            ],
            onUseAnyway: onUseAnyway ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('lists the problems and lets the image through anyway', (
      WidgetTester tester,
    ) async {
      bool used = false;
      await pumpQuality(tester, onUseAnyway: () => used = true);

      expect(find.text('The image may be difficult to read.'), findsOneWidget);
      expect(find.textContaining('Blurry image'), findsOneWidget);
      expect(find.textContaining('Glare or reflection'), findsOneWidget);

      // A poor scan the doctor can squint at beats no scan at all, so using it is the
      // primary action rather than a grudging fallback.
      final MkButton button = tester.widget<MkButton>(
        find.widgetWithText(MkButton, 'Use this image'),
      );
      expect(button.emphasis, MkButtonEmphasis.primary);

      await tester.tap(find.text('Use this image'));
      expect(used, isTrue);
    });

    testWidgets('offers no retry assistance and no staff help', (WidgetTester tester) async {
      await pumpQuality(tester);

      // The specification is explicit: this screen is `Use this image` or `Exit`.
      final Iterable<MkButton> buttons = tester.widgetList<MkButton>(find.byType(MkButton));
      expect(
        buttons.map((MkButton b) => b.label).toSet(),
        <String>{'Use this image', 'Exit'},
      );
    });
  });

  group('OCR status', () {
    Future<void> pumpStatus(
      WidgetTester tester, {
      required List<AttachedDocument> attached,
      VoidCallback? onContinue,
    }) {
      return tester.pumpWidget(
        host(
          OcrStatusScreen(
            strings: strings,
            attached: attached,
            onContinue: onContinue ?? () {},
            onExit: () {},
          ),
        ),
      );
    }

    testWidgets('counts and numbers only the documents that were stored', (
      WidgetTester tester,
    ) async {
      await pumpStatus(
        tester,
        attached: <AttachedDocument>[
          doc(id: 'a', kind: DocumentKind.labReport, extraction: 'AWAITING_CLINICIAN_REVIEW'),
          doc(id: 'b', kind: DocumentKind.prescription),
          doc(id: 'c', state: 'REJECTED_INVALID', extraction: null),
        ],
      );

      expect(find.text('Documents uploaded: 2'), findsOneWidget);
      expect(find.textContaining('1. Lab report'), findsOneWidget);
      expect(find.textContaining('2. Prescription — reading in progress'), findsOneWidget);
    });

    testWidgets('states that originals are kept and the doctor verifies', (
      WidgetTester tester,
    ) async {
      await pumpStatus(tester, attached: <AttachedDocument>[doc()]);

      expect(find.text('The original documents are saved.'), findsOneWidget);
      expect(
        find.text('Extracted information must be verified by the doctor.'),
        findsOneWidget,
      );
    });

    testWidgets('shows no extracted text and no confidence score', (
      WidgetTester tester,
    ) async {
      await pumpStatus(
        tester,
        attached: <AttachedDocument>[doc(extraction: 'AWAITING_CLINICIAN_REVIEW')],
      );

      // Showing what OCR read invites the patient to believe it, or to correct it into
      // the record. Neither is theirs to do — a clinician verifies extraction.
      expect(find.textContaining('%'), findsNothing);
      expect(find.textContaining('confidence'), findsNothing);
      expect(find.textContaining('mg'), findsNothing);
      expect(find.textContaining('OCR'), findsNothing);
    });

    testWidgets('continue is live while extraction is still pending', (
      WidgetTester tester,
    ) async {
      bool continued = false;
      await pumpStatus(
        tester,
        attached: <AttachedDocument>[doc(extraction: 'PENDING')],
        onContinue: () => continued = true,
      );

      // OCR must never hold up a token.
      await tester.tap(find.text('Continue'));
      expect(continued, isTrue);
    });

    testWidgets('a failed extraction is not shown to the patient as a failure', (
      WidgetTester tester,
    ) async {
      await pumpStatus(tester, attached: <AttachedDocument>[doc(extraction: 'FAILED')]);

      expect(find.textContaining('saved — the doctor will read it'), findsOneWidget);
      expect(find.textContaining('failed'), findsNothing);
      expect(find.textContaining('Failed'), findsNothing);
      expect(find.textContaining('error'), findsNothing);
    });
  });
}
