# DatSer App Platform Strategy

## Shared application core

DatSer keeps one React application, one canonical Supabase schema, and one IndexedDB mutation queue. Web, PWA, and Capacitor builds must use the same identity recovery, idempotency, RLS, attendance, and realtime rules. A platform package must not introduce a second data model.

## iPhone

The installable PWA is the current primary iPhone experience. Maintain:

- the fixed app shell with an anchored header and bottom action dock;
- dynamic viewport units, safe-area insets, and central `visualViewport` handling;
- keyboard-safe form sheets with internally scrolling bodies and accessible footers;
- IndexedDB snapshots and pending mutations;
- service-worker update prompts that do not publicly cache private API responses.

iOS does not guarantee that a fully closed PWA will run background sync. DatSer must preserve queued work while closed and flush it immediately when reopened, focused, or reconnected. Do not describe closed-app background delivery as guaranteed.

## Android

Continue packaging the React application with Capacitor. The same IndexedDB queue and Supabase idempotency rules apply in browser and APK environments.

`isLocalWebDeveloperModeAllowed()` requires a development build, a localhost origin, and a non-native runtime. Therefore the production web build and Android APK must never show **Enter Developer Mode**. Production smoke tests must retain this assertion.

Before release, validate the generated APK in an emulator or physical Android device for:

- launch/login/session restore;
- Add/Edit/Complete Missing Info;
- Present/Absent/Clear online and offline;
- reconnect queue flush;
- QR scanner and member pass;
- safe-area and software-keyboard layout.

## Future native iOS package

Keep the web app compatible with Capacitor iOS. App Store packaging can be completed later with macOS/Xcode access or a hosted macOS build environment. Do not rewrite DatSer in Flutter, React Native, Xamarin, or another framework merely to create an iOS package, and do not block current reliability work on purchasing a Mac.

## Release gates

Every platform release should pass lint, unit tests, build, local smoke, production smoke, service simulation, and reviewed responsive/visual checks. Physical-device results must be reported separately from browser emulation.
