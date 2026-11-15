# Pizzaiolo – Restaurant Bestell-App (Kellner → Küche) mit Sprachnotizen

## Original problem statement
Restaurants use apps where waiters send orders per table to the kitchen. The user asked for this in Kotlin for Android. The platform only supports Expo, so it is built in React Native/Expo. For each ordered dish, the waiter can add a voice note that the kitchen can open and listen to. Menu: 1 Pizza Margherita 12 €, 2 Pizza Funghi 12 €, 3 Pizza al Casa 15 €.

## User choices
- Speech-to-Text (OpenAI gpt-4o-mini-transcribe, German, Emergent LLM Key) plus the audio itself
- Separate logins for waiter and kitchen (JWT)
- Warm restaurant colors (cream, terracotta, espresso)
- 10 tables
- Testing on 2 emulators (waiter + kitchen): sync through polling every 3 s

## Architecture
- Backend: FastAPI + MongoDB (users, orders, voice_notes), bcrypt + JWT, Emergent Object Storage for the audio, Whisper-style transcription
- Frontend: Expo Router: /login, /waiter (table grid), /waiter/table/[id] (menu, draft, mic per dish, active orders, mark served), /kitchen (status chips Neu / In Zubereitung / Fertig, tickets with transcript and Anhören button)
- Status flow: new → preparing → ready (kitchen) → served (waiter)

## Implemented (June 2026)
- Iteration 6: demo login removed (no role cards, demo button or hints); must_change_password flag + password_version in JWT (password change revokes old tokens); POST /api/auth/change-password; /api/security/status plus an owner banner and staff badges; receipt settings /settings (name, address, Google review link) with a QR code on the receipt (qrcode-generator GIF data URL); back buttons fall back after a reload.
- Iteration 5: voice fix: the 2000-byte "zu kurz" limit is gone (only < 300 B is rejected, with an emulator-microphone hint); recording lasts at least 1.2 s plus a 400 ms tail; no Blob re-wrap on native; duration_ms is logged; a hint when no text is recognised; cancel/session handling; web picks webm or mp4.
- Iteration 4: staff management (/staff, owner: create/reset password/delete waiter+kitchen accounts; seeding runs once via db.meta seed_users_v1; global 401 → logout), revenue history (/api/reports/history 7d/30d/12w, chart + weekday averages, owner only), PDF receipt (expo-print + expo-sharing; web prints via a hidden iframe). Login: trimmed password, eye toggle, demo-fill button.
- Iteration 3: split bill by dish (partial payments, payments collection, per-table lock), move a table / merge tables, owner role "inhaber" with menu management (add, edit, hide dishes; menu stored in Mongo). Report: paid = payments today. Table tiles show the open amount.
- Iteration 2: quantity per dish (stepper, lines merged), edit/type the note text in the modal, bill per table plus "Tisch abschließen" (paid flag, table status "Rechnung offen"), daily revenue report /report (revenue paid/open, per waiter, top pizza). 20/20 backend tests
- Login, role-based routing, demo accounts (see test_credentials.md)
- Orders per table, voice note per dish (record, transcribe, store), kitchen listens and reads
- Toasts, haptics, microphone permissions with an Open Settings fallback
- Backend 15/15 tests passing; frontend flows tested

## Backlog
- P1: Revenue history for past days/weeks
- P2: Upload photos for new dishes, delete voice notes, receipt as PDF/print
- Test-Anmeldung ohne Passwort (Buttons Kellner/Küche/Inhaber auf Login, /api/auth/demo-login)
