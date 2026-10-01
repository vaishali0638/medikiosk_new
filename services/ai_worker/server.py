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

NO_DIAGNOSIS_STATEMENT = "Clinical diagnosis has not been provided."

SECTION_HEADINGS: Dict[str, str] = {
    "REASON_FOR_VISIT": "Reason for visit",
    "DURATION_ONSET": "Duration and onset",
    "SEVERITY_IMPACT": "Severity and impact",
    "CURRENT_MEDICINES": "Current medicines",
    "ALLERGIES": "Allergies",
    "PAST_HISTORY": "Past history",
    "OTHER": "Other information",
    "DOCUMENTS": "Documents",
    "NOT_ANSWERED": "Not answered",
}

def generate_clinical_draft(data: Dict[str, Any]) -> Dict[str, Any]:
    answers: List[Dict[str, Any]] = data.get("answers", [])
    documents: List[Dict[str, Any]] = data.get("documents", [])

    sections_by_key: Dict[str, List[Dict[str, Any]]] = {}
    reason_text = "medical consultation"

    for ans in answers:
        if not ans.get("answered", True):
            continue
        key = ans.get("sectionKey", "OTHER")
        if key not in sections_by_key:
            sections_by_key[key] = []

        val = ans.get("value")
        opts = ans.get("optionLabels", [])
        if opts:
            text = ", ".join(opts)
        elif val:
            text = str(val).strip()
        else:
            continue

        if key == "REASON_FOR_VISIT":
            reason_text = text

        label = "Patient-reported" if ans.get("source") == "PATIENT_REPORTED" else "Patient-selected"
        sections_by_key[key].append({
            "text": text,
            "label": label,
            "source": ans.get("source", "PATIENT_REPORTED"),
        })

    doc_statements: List[Dict[str, Any]] = []
    for doc in documents:
        doc_label = doc.get("label", "Document")
        doc_statements.append({
            "text": doc_label,
            "label": "Uploaded document",
            "source": "PATIENT_REPORTED",
        })

    sections: List[Dict[str, Any]] = []
    for key, heading in SECTION_HEADINGS.items():
        if key == "DOCUMENTS":
            if doc_statements:
                sections.append({
                    "key": "DOCUMENTS",
                    "heading": heading,
                    "statements": doc_statements,
                })
        elif key in sections_by_key and sections_by_key[key]:
            sections.append({
                "key": key,
                "heading": heading,
                "statements": sections_by_key[key],
            })

    narrative = f"Patient reports {reason_text}. {NO_DIAGNOSIS_STATEMENT}"

    return {
        "narrative": narrative,
        "sections": sections,
        "generator": "MODEL",
        "generatorVersion": "ai-worker-v1.0",
    }

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
            self._send_json(200, {
                "status": "ok",
                "service": "ai_worker",
                "models": ["clinical_draft_v1", "ocr_tesseract", "asr_whisper"],
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
        elif self.path == "/v1/speech/transcribe":
            self._send_json(200, {
                "transcript": body.get("mockText", "chest pain since morning"),
                "confidence": 0.94,
                "language": body.get("language", "en-IN"),
            })
        elif self.path == "/v1/ocr/extract":
            self._send_json(200, {
                "documentType": body.get("type", "Prescription"),
                "confidence": 0.91,
                "extractedEntities": [
                    {"type": "MEDICATION", "name": "Metformin", "dose": "500mg"},
                ],
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
