# Member V2 Android validation APK

This branch builds a separate, disposable debug application for Member V2.
It has package ID `com.datser.app.memberv2test`, so it cannot replace the
normal DatSer install or read its storage.

The APK bundles its web assets. It contains no Supabase URL, anon key, user
password, service-role key, or production endpoint. On first launch it asks
for the local API URL and public anon key. Configure it only after installation
with values supplied by the local CLI. Do not use this process for production.

## Build

```powershell
npm run android:member-v2-test
```

The generated APK is:

```text
android/app/build/outputs/apk/memberV2Validation/app-memberV2Validation.apk
```

## Emulator configuration

With the local stack running, pass the configuration directly to the isolated
test package. `10.0.2.2` is the Android emulator route to the Windows host.
The command must obtain the anon key locally; do not paste it into source,
shell history, screenshots, or Git.

```powershell
# Read the local API URL and public anon key into process variables only.
$status = npx supabase status -o json | ConvertFrom-Json
Enter the following values in the test app's first-launch prompt:

- Local API URL: `http://10.0.2.2:54321`
- Local public anon key: `$status.ANON_KEY`
```

For a USB-connected physical device, first run `adb reverse tcp:54321
tcp:54321`, then enter `http://127.0.0.1:54321` in the prompt. The APK
stores this public client configuration privately on the test app only; it
does not receive a user password or any privileged key.
