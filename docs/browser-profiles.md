# Browser profiles and identity audit

`src/infrastructure/browser/profile/` owns identity. The runtime derives its browser version from the executable and its hardware/GPU from a synthetic secure page fulfilled in memory. No external fingerprint collection is required to start a session.

## Architecture

| Component | Responsibility |
| --- | --- |
| `BrowserProfile` | Typed, runtime-validated complete identity and consistency constraints |
| `DeviceCatalog` / `BrowserProfileGenerator` | Whole device presets and explicit population weights |
| `UserAgentProvider` / `ClientHintsProvider` | UA, low/high entropy hints and CDP metadata from the same release/OS |
| `StableVersionProvider` | Optional, explicit refresh from official Chrome, Microsoft and Mozilla release feeds; five-second request deadline and one-day cache |
| `LocaleProvider` / `TimezoneProvider` | Canonical language headers and ICU country/timezone validation |
| `ProxyLocationProvider` | Validated geography measured by a page in the proxied browser |
| `RuntimeProfile` | Observe native capabilities, reconcile saved identity, apply browser emulation APIs |
| `ProfileStore` | Validated atomic identity sidecar inside a leased Chrome data directory |
| `ProfileAudit` | Compare observed document signals with the saved profile; report native permissions, fonts and worker observations |

Stable release discovery does not silently upgrade Chrome or pretend an old executable is current. Provision Chrome with `npm run download-browsers` after a deliberate Puppeteer update. Safari versions must be supplied from the installed Safari environment; there is no invented Safari release feed. Catalog fixtures use explicit versions and are not claims about today's stable releases.

Edge product versions differ from Chromium engine versions. Generating an Edge profile requires both the product version and its observed `engineVersion`; the Edge release feed alone does not establish the engine version.

`BrowserProfileGenerator.select(weights, sample)` accepts measured population weights from the caller. It chooses a whole preset. There is no hard-coded claim about global browser market share, and the current runtime defaults to the native host rather than sampling unavailable browsers.

## Runtime support and presets

Set `BROWSER_PROFILE=native` (default), or a Chrome desktop preset matching the host OS. Windows offers `windows-chrome-1440` and `windows-chrome-1920`; macOS offers `macos-chrome`; Linux offers `linux-chrome`. The numbers describe CSS screen size; the initial content viewport reserves space for browser chrome. Runtime hardware and GPU replace catalog examples with measured values.

The catalog additionally models `windows-edge-1920`, `macos-safari`, `linux-firefox`, `pixel-7-chrome`, `samsung-s23-chrome`, and `iphone-15-safari`. These are **model fixtures, not executable adapters**. Running them requires the corresponding native browser/OS/device implementation. The current adapter rejects cross-OS, mobile and non-Chrome identities. A desktop browser cannot accurately emulate mobile fonts, codecs, rendering and permissions through a UA override.

Presets are representative configurations, not a database of measured physical devices. GPU examples are never injected into a running browser. Container software rendering remains software rendering. DPR and viewport are explicit emulation settings and do not change the actual graphics hardware.

## Audit findings and signal policy

The former implementation independently selected UA versions, platforms, hardware, GPU and rendering noise. This could combine Windows headers with Apple GPU claims and regenerate identity on every launch. Those services and stealth plugin dependencies have been removed. Historical `useragent/` files are no longer read by the runtime or copied into Docker.

| Signal | Current policy / verification |
| --- | --- |
| UA and browser version | Installed Chrome release; reduced UA and full-version client hints agree |
| Platform / client hints | Same OS, mobile flag, brands, architecture, bitness and platform version; outgoing headers and JavaScript tested locally |
| Language / languages / Accept-Language / Intl locale | One locale policy, applied together; independent identity header overrides rejected |
| Timezone | Native timezone or validated proxy geography; browser API override |
| Viewport / screen / DPR | One profile; available-screen dimensions reflect Chrome's emulation behavior |
| CPU / memory / WebGL | Observed native values, never randomized or patched |
| Canvas / audio | Native APIs; tests verify repeatable pixel reads and an unmodified constant audio signal |
| Fonts / layout | Native installed fonts and metrics; no added noise. Font checks in reports indicate API behavior, not a reliable font inventory |
| Permissions | Native prompt/denial behavior; explicit geolocation grant only for the configured target |
| Automation | Native `navigator.webdriver`; no concealment patch |
| Workers / embedded frames | Report worker observations where CSP permits; document-level CDP overrides are not a guarantee of identical service/shared-worker or cross-origin-frame signals |

The audit's `consistent` flag covers its explicit document checks, not an assertion that every browser surface is indistinguishable from a physical user's device. Worker observations are diagnostic; sites may block the blob-worker probe through CSP. Full native adapters and worker/frame coverage remain necessary before expanding browser support.

Client hints and device memory can be unavailable outside secure contexts. The runtime preserves Chrome's security rules; the local audit fixtures use trusted loopback origins and external audit URLs use HTTPS.

Chrome's [UA Client Hints documentation](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints) explains reduced UA versus high-entropy metadata. [ChromeDriver mobile emulation guidance](https://developer.chrome.com/docs/chromedriver/mobile-emulation) describes device metrics and client hints; emulation is not a substitute for a physical mobile environment.

## Proxy geography

```env
MATCH_GEOLOCATION=true
PROXY_LOCATION_URL=https://your-controlled-lookup.example/location
GRANT_GEOLOCATION=false
```

Also configure a browser proxy. Workers may receive that proxy in a job. The endpoint must return normalized JSON such as:

```json
{"country":"BR","timezone":"America/Sao_Paulo","latitude":-23.55,"longitude":-46.63}
```

Coordinates are optional but must be paired. Country and timezone are required: country alone cannot identify the correct timezone. Brazil selects `pt-BR`, `['pt-BR','pt']` and `pt-BR,pt;q=0.9`. Policies currently cover BR, US, GB, DE, FR, CA, AU, JP and IN. Unsupported countries and inconsistent timezone/country pairs fail before target navigation. Extend the explicit locale policy for additional countries; do not infer an arbitrary location.

The lookup runs through a separate page in the launched browser with its proxy credentials. It never uses the host telemetry client and is not cached across sessions. Cross-origin lookup requests are blocked. HTTPS is required except loopback HTTP test fixtures; Chrome normally bypasses proxies for loopback. Lookup errors fail the session. Do not log endpoint credentials or return arbitrary executable content.

`GRANT_GEOLOCATION=true` requires coordinates and grants the configured target only. Otherwise permissions remain native. Coordinate accuracy is reported as 1000 metres; IP-based coordinates are approximate, not a GPS measurement. Timezone validation does not establish that the supplied coordinates are geographically accurate; trust and validate your lookup provider.

## Persistence

`PERSISTENT_SESSIONS=true` retains Chrome cookies, localStorage, cache and browser preferences. A versioned `browser-profile.json` sidecar retains identity. The orchestrator acquires `ProfileLease` before launch and releases it after browser shutdown. Direct users of the engine must acquire the same lease when passing `userDataDir`.

Before each launch, Trafficbot sets Chrome's `session.restore_on_startup` preference to the new-tab mode. Chrome's separate tab-restore files are moved into `Default/Trafficbot Session Archive/` so macOS cannot reopen them before page-level identity and navigation policy are installed. The files remain recoverable and all other preferences, cookies, storage, cache and history remain intact.

Saved identity wins over new defaults. Hardware/GPU, native OS, device or proxy geography changes fail explicitly; use the original environment or a new session key. An actual browser upgrade updates UA/version/client hints while preserving preferences. Corrupt sidecars fail closed and are not silently replaced. Existing Chrome directories without a sidecar adopt one on their next launch without deleting cookies or storage. Legacy fingerprint noise cannot be recovered as a stable identity.

Sessions need a stable proxy exit location when matching is enabled. Reusing a saved country without enabling matching does not verify the current proxy. Chrome may still change native rendering after OS, driver or font updates; a saved JSON profile cannot freeze those components.

## Verification and external audit scripts

`npm test -- --runInBand` checks generation, impossible combinations, client hints, version providers, geography and sidecar persistence. `npm run test:browser` uses only local fixtures, including a local HTTP proxy, and checks document identity, headers, native rendering, cookies/localStorage after restart, navigation scope and cleanup. Redis and lifecycle suites exercise queued execution separately.

External audits are deliberate manual diagnostics and are not CI gates:

```bash
npm run audit:fingerprint -- browserleaks --external --persistent
npm run audit:fingerprint -- amiunique --external --persistent
npm run audit:fingerprint -- pixelscan --external --persistent
npm run audit:fingerprint -- fingerprintjs --external --persistent
```

The default is a visible browser. Add `--headless` only when no display is available. Reports are written under ignored `logs/fingerprint-audits/`; inspect the website's result separately. The command collects document signals after ten seconds, leaves a headed browser open another thirty seconds, and exits nonzero for a local consistency failure. Cross-origin top-level redirects remain blocked. Service consent flows, CSP or availability may prevent a complete audit; no bypass or automatic positive verdict is implemented. `test:fingerprint`, `verify_stealth.ts` and `scripts/verify-hardening.ts` delegate to this same opt-in CLI.

The CLI honors `BROWSER_PROFILE`, proxy and location settings from configuration. Persistence is selected with `--persistent` and uses a separate `fingerprint-audit` key under `SESSIONS_DATA_DIR`.

Expected observations:

- BrowserLeaks: document UA, platform, screen, languages and timezone match the report; native GPU/fonts remain visible.
- AmIUnique: a fingerprint may be unique. Compare signals and repeat sessions; uniqueness is not a failure or success criterion.
- Pixelscan: automation or environment warnings may remain. Record them; do not interpret document consistency as a detection bypass.
- FingerprintJS: persistent state can be compared across restarts; visitor IDs are service-dependent and not guaranteed stable.

These commands contact third parties and disclose browser signals. None is run by the local verification suite. Reports may include identifying device information and should stay out of Git.

## Verification record (2026-09-26)

Build, lint and artifact checks passed locally. The unit suite passed 68 tests; dedicated browser, Redis and lifecycle suites passed 9, 5 and 12 tests respectively. Browser fixtures were local only. Two additional visible six-second bot sessions exercised navigation and human behavior with one persistent profile: both completed near their target duration, every observed identity header matched, and cookies/localStorage survived the restart. The compiled runtime also passed the signal audit as the unprivileged user with Chrome's sandbox enabled in the previously provisioned Linux image; this does not certify a fresh image build. Brazil country/timezone validation was checked on that image's Node 22 runtime. The runtime dependency audit still reports four high-severity findings in the existing Puppeteer archive-extraction chain.

The fresh Docker build completed dependency installation and TypeScript compilation but was stopped after browser provisioning stalled for several minutes. Fresh-image verification remains incomplete; no external fingerprint audit site was visited during verification.
