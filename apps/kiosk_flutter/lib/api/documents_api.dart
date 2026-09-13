import 'dart:convert';
import 'dart:typed_data';

import 'api_client.dart';
import '../screens/document_screens.dart';

/// Upload and status calls for previous records.
///
/// Deliberately thin. The kiosk sends bytes and reads back a state; it does not compute
/// hashes, does not decide whether a file is acceptable, and never sees extracted text.
/// All three are the server's job, because a kiosk in a waiting room is the one part of
/// this system an attacker can physically touch.
class DocumentsApi {
  const DocumentsApi(this._client);

  final ApiClient _client;

  /// Uploads one document. Returns the stored record, or throws [ApiException].
  ///
  /// A rejected file (bad magic bytes, oversized, malware signature) comes back as a
  /// `VALIDATION_FAILED` exception whose patient message says only that the document was
  /// not accepted — the kiosk must not elaborate.
  Future<AttachedDocument> upload({
    required String preCheckinId,
    required DocumentKind kind,
    required String contentType,
    required Uint8List bytes,
    String? originalFilename,
    String? documentDate,
  }) async {
    final Map<String, dynamic> response = await _client.post(
      '/v1/precheckins/$preCheckinId/documents',
      <String, dynamic>{
        'documentType': kind.wire,
        'contentType': contentType,
        'data': base64Encode(bytes),
        if (originalFilename != null) 'originalFilename': originalFilename,
        if (documentDate != null) 'documentDate': documentDate,
      },
    );

    return AttachedDocument(
      id: response['documentId'] as String,
      kind: kind,
      state: response['state'] as String,
      // The server answers 'QUEUED' on upload; the list endpoint carries the real
      // extraction state once a worker has looked at it.
      extractionState: 'PENDING',
    );
  }

  /// Everything attached to this visit so far, with extraction state.
  Future<List<AttachedDocument>> list(String preCheckinId) async {
    final Map<String, dynamic> response =
        await _client.get('/v1/precheckins/$preCheckinId/documents');
    final List<dynamic> items = (response['documents'] as List<dynamic>?) ?? <dynamic>[];

    return items
        .cast<Map<String, dynamic>>()
        .map(_toAttached)
        .whereType<AttachedDocument>()
        .toList(growable: false);
  }

  AttachedDocument? _toAttached(Map<String, dynamic> row) {
    final String wire = row['documentType'] as String;
    final DocumentKind? kind = DocumentKind.values
        .where((DocumentKind k) => k.wire == wire)
        .firstOrNull;
    // A type this build does not know about is dropped rather than guessed at. Showing it
    // as "Other" would tell the patient their lab report was filed as something else.
    if (kind == null) return null;

    return AttachedDocument(
      id: row['documentId'] as String,
      kind: kind,
      state: row['state'] as String,
      extractionState: row['extractionState'] as String?,
    );
  }
}
