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
- Login, role-based routing, demo accounts (see test_credentials.md)
- Orders per table, voice note per dish (record, transcribe, store), kitchen listens and reads
- Toasts, haptics, microphone permissions with an Open Settings fallback
- Backend 15/15 tests passing; frontend flows tested

## Backlog
- P1: Edit the transcript text by hand / text-only note
- P1: Quantity per dish, table transfer, bill / payment
- P2: Daily revenue report, manage the menu in the app, delete voice notes
