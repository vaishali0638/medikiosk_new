# ai_worker — placeholder

Python FastAPI service for ASR, TTS, OCR, extraction, confidence scoring and constrained
summary generation.

**Not implemented.** Phases 10 and 11 build this. It is listed here so the repository layout
matches the architecture and so nothing silently assumes an AI service already exists.

Every capability here is behind a feature flag (`FEATURE_OCR`, `FEATURE_AI_SUMMARY`,
`FEATURE_VOICE_INTAKE`), all of which default to off. The kiosk must remain fully usable by
touch with this service absent.
