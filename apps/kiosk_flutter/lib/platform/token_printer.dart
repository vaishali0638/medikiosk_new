import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Why a print attempt did not produce paper.
enum PrintFailure { noPaper, offline, hardwareError, unavailable }

@immutable
class PrintResult {
  const PrintResult.printed()
      : printed = true,
        failure = null;
  const PrintResult.failed(this.failure) : printed = false;

  final bool printed;
  final PrintFailure? failure;
}

@immutable
class TokenSlip {
  const TokenSlip({
    required this.token,
    required this.departmentName,
    this.room,
    this.queueStatus,
  });

  final String token;
  final String departmentName;
  final String? room;
  final String? queueStatus;
}

/// The 80mm thermal printer in the kiosk enclosure.
///
/// Printing is a CONVENIENCE, never a step the token depends on. The hospital has already
/// issued it and the screen already shows it, so a jam or an empty roll must leave the
/// patient with a valid token they can read and photograph — never send them back to a
/// queue they have already passed through.
abstract interface class TokenPrinter {
  Future<PrintResult> printToken(TokenSlip slip);
  Future<bool> isAvailable();
}

class PlatformTokenPrinter implements TokenPrinter {
  const PlatformTokenPrinter([this._channel = _defaultChannel]);

  static const MethodChannel _defaultChannel = MethodChannel('org.medikiosk/printer');
  final MethodChannel _channel;

  @override
  Future<PrintResult> printToken(TokenSlip slip) async {
    try {
      final bool ok = await _channel.invokeMethod<bool>('print', <String, Object?>{
            'token': slip.token,
            'department': slip.departmentName,
            'room': slip.room,
            'queueStatus': slip.queueStatus,
          }) ??
          false;
      return ok
          ? const PrintResult.printed()
          : const PrintResult.failed(PrintFailure.hardwareError);
    } on PlatformException catch (e) {
      final PrintFailure failure = switch (e.code) {
        'NO_PAPER' => PrintFailure.noPaper,
        'OFFLINE' => PrintFailure.offline,
        _ => PrintFailure.hardwareError,
      };
      return PrintResult.failed(failure);
    } on MissingPluginException {
      return const PrintResult.failed(PrintFailure.unavailable);
    }
  }

  @override
  Future<bool> isAvailable() async {
    try {
      return await _channel.invokeMethod<bool>('isAvailable') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// Printer for builds with no hardware. Reports unavailable rather than faking success.
class UnavailableTokenPrinter implements TokenPrinter {
  const UnavailableTokenPrinter();

  @override
  Future<PrintResult> printToken(TokenSlip slip) async =>
      const PrintResult.failed(PrintFailure.unavailable);

  @override
  Future<bool> isAvailable() async => false;
}

@visibleForTesting
class ScriptedTokenPrinter implements TokenPrinter {
  ScriptedTokenPrinter({this.failWith, this.available = true});

  PrintFailure? failWith;
  bool available;
  final List<TokenSlip> printed = <TokenSlip>[];

  @override
  Future<PrintResult> printToken(TokenSlip slip) async {
    if (failWith != null) return PrintResult.failed(failWith);
    printed.add(slip);
    return const PrintResult.printed();
  }

  @override
  Future<bool> isAvailable() async => available;
}
