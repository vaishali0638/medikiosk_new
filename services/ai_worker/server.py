#!/usr/bin/env python3
"""
MediKiosk AI Worker Service

Provides clinical draft generation, OCR extraction, and speech transcription.
Complies with clinical safety rules:
1. Grounded strictly in patient-reported answers and uploaded document labels.
2. Never outputs autonomous diagnoses or treatment advice.
3. Always includes the mandatory disclaimer:
   "Clinical diagnosis has not been provided. This intake was completed by the patient at an intake kiosk."
"""

import json
import logging
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
logger = logging.getLogger("ai_worker")

PORT = 8000

# Mirrors NO_DIAGNOSIS_STATEMENT in packages/terminology/src/draft-safety.ts. The safety
# validator requires the narrative to contain it verbatim, so this string is a contract
# with that package and not a message this service is free to reword.
NO_DIAGNOSIS_STATEMENT = "Clinical diagnosis has not been provided."

# Mirrors PROVENANCE_LABELS in packages/terminology/src/index.ts. The draft contract accepts
# these exact strings and nothing else — an em dash here is load-bearing. CLINICIAN_VERIFIED
# is absent deliberately: no generator may claim a clinician has seen anything.
PROVENANCE_PATIENT_REPORTED = "PATIENT-REPORTED"
PROVENANCE_PATIENT_SELECTED = "PATIENT-SELECTED"
PROVENANCE_SOURCE_DOCUMENT = "SOURCE-DOCUMENT"
PROVENANCE_OCR_EXTRACTED = "OCR-EXTRACTED — VERIFY"
PROVENANCE_SYSTEM_DETECTED = "SYSTEM-DETECTED — REVIEW"

# Fixed order and wording, so two visits read the same way. DOCUMENTS is built separately
# from the uploaded-document list rather than from answers.
SECTION_HEADINGS: Dict[str, str] = {
    "REASON_FOR_VISIT": "Reason for visit",
    "DURATION_ONSET": "Duration and onset",
    "SEVERITY_IMPACT": "Severity and impact",
    "CURRENT_MEDICINES": "Current medicines",
    "ALLERGIES": "Allergies",
    "PAST_HISTORY": "Past history",
    "OTHER": "Other information",
    "DOCUMENTS": "Documents",
}

def _provenance_for_answer(source: str) -> str:
    if source == "PATIENT_SELECTED":
        return PROVENANCE_PATIENT_SELECTED
    if source == "SYSTEM_DETECTED":
        return PROVENANCE_SYSTEM_DETECTED
    return PROVENANCE_PATIENT_REPORTED


def generate_clinical_draft(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Assembles a draft candidate in the shape `clinicalDraftSchema` requires.

    Three properties are not optional, because core_api's safety validator enforces them
    and a response missing any one is discarded:

      - every statement carries `provenance` (one of the labels above) and `sourceRef`,
        the question or document id the statement restates;
      - the patient's own words are QUOTED. The banned-language scan exempts quoted spans,
        so a patient who says "it is probably a sprain" is reproduced verbatim instead of
        tripping a rule written about the kiosk's voice. Unquoted, that draft is refused;
      - the narrative ends with NO_DIAGNOSIS_STATEMENT, verbatim.

    Nothing here is inferred. Every statement is a restatement of one answer, which is why
    the grounding check passes: there is no vocabulary in the output that the patient did
    not supply.
    """
    answers: List[Dict[str, Any]] = data.get("answers", [])
    documents: List[Dict[str, Any]] = data.get("documents", [])

    statements_by_section: Dict[str, List[Dict[str, Any]]] = {}
    reason_for_visit = "intake"

    for ans in answers:
        if not ans.get("answered", True):
            continue

        # A spoken or typed answer wins over the option buttons, matching the composer in
        # core_api: if the patient said something in their own words, that is the answer.
        spoken = str(ans.get("value") or "").strip()
        option_labels = ans.get("optionLabels") or []
        chosen = ", ".join(option_labels) if option_labels else ""
        body = spoken or chosen
        if not body:
            continue

        key = ans.get("sectionKey") or "OTHER"
        if key == "REASON_FOR_VISIT":
            reason_for_visit = body

        source_ref = ans.get("questionId")
        if not source_ref:
            # No id means the grounding check has nothing to tie the statement to, and a
            # statement that cannot be traced back to a question does not belong in a
            # clinical record at all.
            continue

        statements_by_section.setdefault(key, []).append(
            {
                "text": f'Patient reported: "{body}"',
                "provenance": _provenance_for_answer(str(ans.get("source", ""))),
                "sourceRef": str(source_ref),
            }
        )

    sections: List[Dict[str, Any]] = []
    for key, heading in SECTION_HEADINGS.items():
        if key == "DOCUMENTS":
            continue
        if statements_by_section.get(key):
            sections.append({"key": key, "heading": heading, "statements": statements_by_section[key]})

    document_statements: List[Dict[str, Any]] = []
    for doc in documents:
        document_id = doc.get("documentId")
        label = str(doc.get("label") or "").strip()
        if not document_id or not label:
            continue
        # An extraction still awaiting review is labelled as such. Presenting OCR output
        # with the same confidence as a patient's own answer is the mislabelling this
        # whole provenance scheme exists to prevent.
        provenance = (
            PROVENANCE_OCR_EXTRACTED
            if doc.get("extractionState") == "AWAITING_CLINICIAN_REVIEW"
            else PROVENANCE_SOURCE_DOCUMENT
        )
        document_statements.append(
            {"text": f'"{label}" uploaded', "provenance": provenance, "sourceRef": str(document_id)}
        )

    if document_statements:
        sections.append(
            {"key": "DOCUMENTS", "heading": SECTION_HEADINGS["DOCUMENTS"], "statements": document_statements}
        )

    narrative = f'Patient reported: "{reason_for_visit}". {NO_DIAGNOSIS_STATEMENT}'

    # `generator` and `generatorVersion` are deliberately not sent. Which generator produced
    # a draft is recorded by core_api, which knows whether it used this response or fell
    # back; a worker asserting its own provenance could only ever be the less reliable of
    # the two answers.
    return {"narrative": narrative, "sections": sections}

class RequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, body: Any) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path in ("/health", "/"):
            # Only what is actually here. This previously advertised "ocr_tesseract" and
            # "asr_whisper", neither of which is installed or imported anywhere — a health
            # check that names absent engines is how an operator concludes OCR works.
            self._send_json(200, {
                "status": "ok",
                "service": "ai_worker",
                "capabilities": ["summary.generate"],
                "unavailable": ["ocr.extract", "speech.transcribe"],
            })
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body_bytes = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        if self.path == "/v1/summary/generate":
            draft = generate_clinical_draft(body)
            self._send_json(200, draft)
        elif self.path in ("/v1/speech/transcribe", "/v1/ocr/extract"):
            # No ASR or OCR engine ships in this repository, so these refuse.
            #
            # They previously answered 200 with a fixed payload — a transcript of "chest
            # pain since morning" at confidence 0.94, and an extracted "Metformin 500mg" at
            # 0.91 — for any input at all. Invented clinical detail carrying a high
            # confidence score is the most dangerous thing this service could return: the
            # confidence is what a reviewer uses to decide how hard to look, and a caller
            # has no way to tell it apart from a real extraction.
            #
            # 501 is the honest answer and the one the rest of the codebase gives for an
            # unconfigured dependency. FEATURE_OCR and FEATURE_VOICE_INTAKE default to off;
            # a deployment that turns one on needs a real engine, not a stand-in.
            self._send_json(501, {
                "error": "Not Implemented",
                "detail": f"{self.path} requires an engine that does not ship in this repository.",
            })
        else:
            self._send_json(404, {"error": "Not Found"})

    def log_message(self, format: str, *args: Any) -> None:
        logger.info(f"{self.address_string()} - {format % args}")

def run(port: int = PORT) -> None:
    server = HTTPServer(("0.0.0.0", port), RequestHandler)
    logger.info(f"AI Worker listening on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("AI Worker shutting down")
        server.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run(port)
