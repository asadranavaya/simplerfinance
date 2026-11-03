# iPhone app foundation

The Capacitor app shares the React customer screens and server API with the website. Its packaged frontend is built separately into `dist-app/`; normal website builds still use `dist/`.

The configured server is **https://simplerfinance.net**. Build with a different HTTPS origin using `VITE_API_ORIGIN=https://finance.example.com npm run ios:sync`. Only an origin is accepted: no credentials, path, query, or fragment. The address is public build configuration, never a secret. The app packages its frontend locally; it does not use Capacitor's remote `server.url` setting.

## Current scope

- Shared Home, Spending, Accounts, Analytics, subscriptions/calendar, Settings, notes, tags, and purchase reminders.
- Both spending pie charts and vendor icons are retained.
- Manual expense entry and SimpleFIN synchronization are available.
- PDF export, CSV/PDF file imports, and icon file submissions are excluded from the app UI and PDF/import libraries are excluded from the app bundle. These website features remain available in normal builds.
- Administration stays on the website. An administrator signing in to the app receives a customer-app notice and can sign out.
- Activity refreshes on foreground/resume, purchase changes, and every 30 seconds while visible. This foundation does **not** deliver background push notifications or provide offline financial data.

## Develop on Linux

```bash
npm run bootstrap
npm run server
# In a separate terminal; proxies /api to the local server:
npm run app:preview
```

The browser preview uses local, same-origin API requests even though the packaged native build has a production server address. Run `npm run test:app` for isolated real-API browser checks with synthetic data. This verifies feature exclusions, responsive layouts, charts, notes, categories, reminders, and related workflows without modifying production customer records.

```bash
npx playwright install chromium
npm test
npm run lint --prefix renderer
npm run test:ux
npm run test:app
npm run ios:sync
```

`ios:sync` builds the packaged frontend and copies it into the generated iOS project; these steps work on Linux. `npm run ios:open`, native compilation, Simulator, signing, and device installation require macOS and Xcode. Current Capacitor 8 requirements are in the [environment guide](https://capacitorjs.com/docs/getting-started/environment-setup).

## Native transport and sessions

Native API calls use CapacitorHttp and its OS-managed cookie jar over HTTPS. Existing server authentication, staged verification/MFA, trusted-device cookies, revocation, and ownership checks remain in place. The client does not extract session tokens or put them into localStorage. Redirect following is disabled for native API calls; API errors retain their status and JSON payload. Protected icon assets use the same native HTTP transport rather than cross-site WebView image cookies.

The web server's existing HttpOnly/Secure/SameSite cookie settings and CORS policy are unchanged. Browser requests remain same-origin. Native cookie persistence, MFA, logout, trust expiration, app restarts, and resume behavior must be verified on an actual iOS build; browser and mocked transport checks do not establish those behaviors.

## Compile and test on your Mac

Install Node.js 22+ and full Xcode 26+. Open Xcode once, complete its first-launch setup, and install an iOS Simulator runtime when prompted. Do **not** choose Create a new Xcode project: this branch already includes `ios/App/App.xcodeproj`.

In Terminal, select the full Xcode installation:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
xcodebuild -version
```

Clone the app branch and prepare the existing project:

```bash
git clone --branch feature/ios-app https://github.com/asadranavaya/simplerfinance.git
cd simplerfinance
npm run bootstrap
npm run ios:sync
npm run ios:open
```

In Xcode, wait for Swift packages to resolve, select the **App** scheme and an **iPhone Simulator** destination, then press **Command-R** to compile and launch. If opening manually, choose Open Existing Project and select `ios/App/App.xcodeproj`.

Sign in with a customer/test account on `simplerfinance.net`; edits affect that live account. No local API server or port 5175 preview is needed. Check login/MFA, vendor icons, both spending charts, notes, tags, reminders, logout, and session persistence after quitting and reopening the app.

After frontend changes, run `npm run ios:sync` again and press Command-R in Xcode. For a physical iPhone, connect the phone, enable Developer Mode when prompted, choose your team under the App target's Signing & Capabilities with automatic signing enabled, and select the phone as the run destination.

## Build on a hosted Mac

The manual **Build iPhone simulator app** GitHub Actions workflow uses a macOS runner to build an unsigned simulator `.app` and uploads a ZIP artifact. Run it for this branch after the workflow is available in the repository's default branch. The build does not contact the configured finance server.

The artifact runs in an iOS Simulator on a Mac. It is not an installable iPhone `.ipa`, TestFlight build, or App Store submission. For a physical iPhone, select your Apple development team in Xcode and configure signing. No certificates, provisioning profiles, generated web assets, or personal Xcode state belong in Git.

## Before device distribution

Validate native login and MFA, trusted devices and session revocation, vendor-icon loading, keyboard/safe-area behavior, offline/error recovery, external SimpleFIN links, and foreground Activity refresh on a physical iPhone. Face ID, native push registration/APNs delivery, release signing, privacy declarations, and TestFlight/App Store release are subsequent work.
