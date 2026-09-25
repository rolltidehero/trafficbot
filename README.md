# Veneno Traffic Bot v2

Enterprise-grade stealth traffic generation framework.

## Quick Start (Docker)

1. Clone the repository.
2. Configure `.env` (use `.env.example` as template).
3. Run with Docker Compose:
   ```bash
   docker compose up --build
   ```

```bash
sudo npm run setup:linux
```

### Windows Setup (CMD/PowerShell)

If running on Windows:

1. Ensure **Chrome for Testing** is installed: `npm run download-browsers`.
2. The bot uses `path.join` for cross-platform file paths.
3. If using persistent sessions, ensure the `SESSIONS_DATA_DIR` path is valid for Windows.
4. To run examples on Windows, use **Git Bash** (recommended) or manually set environment variables in CMD:
   ```cmd
   set NODE_ENV=production&& set MAX_SESSIONS=1&& npm start
   ```

## Manual Setup

1. Install dependencies:
   ```bash
   npm ci
   npm run download-browsers
   ```
2. Build the project:
   ```bash
   npm run build
   ```
3. Run in Production:
   ```bash
   npm start
   ```

To see the bot in action with different pre-set configurations (High Concurrency, Targeted URLs, Human Behavior Simulation, etc.), run the interactive example script:

```bash
npm run run:examples # Choice 7 for Behavior Simulation
```

_Requires Node.js 22 or later. Package installation does not provision a browser; `download-browsers` installs the exact Chrome revision expected by the lockfile. Chromium sandbox, web security, and site isolation remain enabled._

## Browser Seeding & Visibility

"Seeding" allows the bot to maintain a persistent reputation by saving cookies and cache across runs.

### 1. Seeding (Persistent Profiles)

Enable `PERSISTENT_SESSIONS` to save browser state to a local directory:

```env
PERSISTENT_SESSIONS=true
SESSIONS_DATA_DIR=./sessions
```

### 2. Visibility (Headed Mode)

Set `HEADLESS=false` to see the browser window while the bot is running (not recommended for large scales):

```env
HEADLESS=false
```

To run a guided seeding session immediately:

```bash
npm run run:examples # Select Option 6
```

### 3. macOS Stability (Apple Silicon)

If you encounter "crash info version 7" or "browser launch failed" on macOS:

1. Ensure you have the **native ARM64** browser: `npm run download-browsers`.
2. Browser downloads automatically select the host architecture.
3. If a persistent profile is locked, stop its owning browser and inspect the lock before manually removing it. Never delete profiles as an automatic recovery step.

## Proxy Configuration

The bot supports HTTP/SOCKS proxies for anonymity.

### 1. Using Tor (Docker - Recommended)

The `docker compose.yml` includes a built-in Tor proxy pool. When running with Docker, the bot is automatically configured to use Tor with rotating IPs.

```bash
docker compose up
```

### 2. Using Local Tor (macOS - Manual Setup)

To use Tor directly on your Mac without Docker:

1. **Install Tor via Homebrew**:
   ```bash
   brew install tor
   ```
2. **Start the Tor service**:
   ```bash
   brew services start tor
   ```
3. **Configure `.env`**:
   ```env
   PROXY_URL=socks5://127.0.0.1
   PROXY_PORT=9050
   ```

_Note: The bot supports SOCKS5 natively. Ensure you use the `socks5://` prefix._

## Testing

The project includes a comprehensive test suite using Jest.

1. **Run All Tests:**

   ```bash
   npm test
   ```

2. **Run Only Unit Tests (Configuration):**

   ```bash
   npx jest src/infrastructure/config/config.test.ts
   ```

3. **Run Browser Integration Tests:**
   ```bash
   npm run test:browser
   ```

_Note: Integration tests satisfy system-level dependencies for running a real browser. If you encounter issues on Linux, ensure you've run `sudo npm run setup:linux` first._

## Configuration (.env)

| Variable              | Default                    | Description                                        |
| --------------------- | -------------------------- | -------------------------------------------------- |
| `DEFAULT_URL`         | `http://127.0.0.1:8080/` | Initial target URL.                                |
| `MAX_SESSIONS`        | `1`                        | Batch size for producers; worker concurrency; local batch size.              |
| `SESSION_TIME`        | `3`                        | Duration per session in minutes (or `random`).     |
| `HEADLESS`            | `true`                     | Run without visible browser.                       |
| `HUMAN_BEHAVIOR`      | `true`                     | Enable mouse movement and scrolling simulation.    |
| `BEHAVIOR_INTENSITY`  | `medium`                   | Interaction frequency (`low`, `medium`, `high`).   |
| `PERSISTENT_SESSIONS` | `false`                    | Save browser profile, cookies, and cache.          |
| `SESSIONS_DATA_DIR`   | `./sessions`               | Directory to store persistent browser profiles.    |
| `PROXY_URL`           | -                          | Proxy server address (e.g., `socks5://127.0.0.1`). |
| `PROXY_PORT`          | -                          | Proxy server port (e.g., `9050`).                  |
| `BOT_ROLE`            | `both`                     | Execution role (`local`, `producer`, `worker`, `both`).     |
| `REDIS_URL`           | `redis://127.0.0.1:6379`   | Redis connection URL for distributed queue.        |
| `ORGANIC_SEARCH`      | `false`                    | Enable search engine navigation before target.     |
| `SEARCH_KEYWORDS`     | -                          | Comma-separated list for organic search.           |
| `REFERRER_POOL`       | -                          | Comma-separated custom referrers.                  |
| `MATCH_GEOLOCATION`   | `false`                    | Unsupported; true fails validation instead of measuring the host.            |

## Distributed Architecture & Scaling

V2.1.0 supports massive horizontal scaling across multiple nodes using a centralized **Redis** task queue.

### Roles:

- **Producer**: Generates traffic sessions and pushes them to the queue. Does not launch browsers.
- **Worker**: Listens to the queue and executes browser sessions. Optimized for high-session nodes.
- **Both** (Default): Starts a worker, enqueues one batch, and remains a service.
- **Local**: Runs a finite sequential batch without Redis and exits after cleanup.

Producer exits after enqueueing; worker remains a service. All distributed roles wait up to `REDIS_READY_TIMEOUT_MS` (default 15000) for Redis. Required infrastructure failures exit nonzero. Only `both` with `LOCAL_FALLBACK=true` may select local execution at startup. A later Redis disconnect suspends readiness and reconnects; it never silently switches to local execution. Queue submissions have a deadline; if it expires, the enqueue outcome may be unknown, so inspect the queue before resubmitting.

### Deployment Scaling:

1. **Infrastructure**: Deploy one Redis instance (standard in `docker compose.yml`).
2. **Producers**: Deploy one instance with `BOT_ROLE=producer`.
3. **Workers**: Deploy as many instances as needed with `BOT_ROLE=worker`. Each worker will pull tasks from the shared queue according to its `MAX_SESSIONS` capacity.

## Stealth & Anonymity

The bot implements multiple layers of protection to bypass advanced detection:

1.  **Diamond Standard Hardening**:
    - **AudioContext Masking**: Injects noise into audio frequency data to neutralize hardware-level identification.
    - **Font & ClientRects Masking**: Perturbs font measurement and element geometry to break font-based fingerprinting.
2.  **Contextual Behavior & Intelligence**:
    - **Thinking Heatmaps**: Non-linear, randomized stay durations for each navigation step.
    - **Weighted Link Selection**: Prioritizes logical navigation targets (About, Products, Pricing) over utility links.
    - **Reading Simulation**: Realistic static pauses with micro-mouse nudges to mimic human reading patterns.
3.  **Advanced Fingerprinting**:
    - **Canvas & WebGL Randomization**: Injects non-destructive noise into canvas data and spoofs GPU vendors/renderers (M1, NVIDIA, Intel).
    - **Modern User-Agents**: Uses a curated pool of **Chrome 140+ and Edge 140+ (2025/2026)** strings with dynamic version randomization.
    - **Hardware Spoofing**: Randomizes `deviceMemory`, `hardwareConcurrency`, and `navigator.platform`.

## Observability & Health

- **Real-time CLI Dashboard**: Live feedback on active sessions, success rates, and average durations directly in your terminal.
- **Optional host telemetry**: `EXTERNAL_IP_CHECK=true` requests host IP/country over HTTPS with a 3-second deadline and a 5-minute cache. Disabled by default and skipped for proxy sessions; it is not a proxy reputation or blacklist check.
- **Structured Logging**: JSON-ready logs via Winston for integration with cloud observability platforms.

## Architecture

The Veneno Traffic Bot follows a modular, decoupled architecture:

- **Orchestrator**: Manages the session lifecycle and delegates actions to the engine.
- **Engine**: Handles browser initialization and low-level interactions (Puppeteer-based).
- **Intelligence Layer**: `BehaviorService` and `FingerprintService` provide the logic for stealth and realism.
- **Observability Layer**: `MetricsService` and `ReputationService` provide real-time monitoring.
- **Queue Layer**: `BullMQ` (Redis-backed) manages distributed tasks across nodes.

## Security Features

- **Diamond Standard Hardening**: Sophisticated masking of JS fingerprints (Canvas, WebGL, Audio, Fonts).
- **Environment Validation**: Fail-fast configuration with Zod.
- **Resource Management**: Structured logging and graceful error handling.
- **Contextual Intelligence**: DOM-aware weighted link prioritization.


## Reliability and scope

`SIGTERM` and `SIGINT` stop readiness, stop intake, and allow worker drain for half of `SHUTDOWN_TIMEOUT_MS` (default 30 seconds). Remaining browser work is cancelled, then queue/Redis resources and monitoring timers are closed. A hard deadline exits nonzero; unfinished distributed jobs remain recoverable by BullMQ. Delivery is at least once, so a retry may repeat a partially executed session. Failed jobs retain their payload and error in Redis after three attempts with exponential 5-second backoff. Treat Redis as trusted infrastructure: queued jobs can choose targets and proxies.

Both local and queued sessions use the same runtime-validated contract, including intensity, proxy, persistent profile key, and duration. `random` resolves once to 1–5 minutes when the job is created, so retries retain the same duration. Profiles use `session-N` under the worker's `SESSIONS_DATA_DIR`; retries and later batches reuse them. Atomic lock directories reject concurrent use on the same filesystem, including shared volumes. Separate workers without a shared volume have separate profiles. Crash leftovers require manual inspection; locks are never stolen automatically.

Navigation compares parsed origins (scheme, hostname, effective port). Same-origin redirects are permitted; cross-origin main-frame requests are aborted before fetching the destination. Organic search explicitly permits Google/Bing/DuckDuckGo origins until the target origin is reached, then closes that exception. Locale/consent redirects outside those origins fail closed. Subresources and embedded frames may still load third-party assets: this is a top-level navigation policy, not a network firewall. Popups are closed. Contextual navigation awaits the response; HTTP 4xx/5xx and navigation timeouts fail the session. Metrics are finalized once, after cleanup, and classify HTTP/timeout/other failures.

## Deployment and verification

Compose forwards `.env` to the bot; fixed container settings override Redis address, profile directory, production mode, and disable local fallback. Use a recent Compose supporting optional `env_file` entries. Redis, proxy, and management ports are not published. Redis uses an AOF volume; profiles and logs have persistent volumes. The container runs as the unprivileged `node` user. Chrome's sandbox needs kernel/container support: Compose supplies `SYS_ADMIN` as described in [Puppeteer's Docker guidance](https://pptr.dev/guides/docker). If this capability is not acceptable, use a compatible sandbox runtime; do not add `--no-sandbox`. Docker targets Linux amd64 (emulated on Apple Silicon).

Readiness is HTTP on container loopback `HEALTH_PORT` (3000): 503 during startup/shutdown or Redis outages, 200 when the configured execution role is ready. It checks service/queue readiness, not external website health. Producer and local modes exit normally on completion and are not restart loops. Worker/both can be restarted by an operator's service policy. Compose waits for Redis health before starting the bot. Optional management access must use an explicit loopback binding with operator-supplied authentication; no management UI ships by default.

```bash
npm ci
npm run download-browsers
npm run build
npm run lint
npm test -- --runInBand
npm run check:artifacts
npm run test:browser
# Dedicated disposable Redis only; tests clear their own queue.
docker run --rm -d --name trafficbot-test-redis -p 127.0.0.1:16389:6379 redis:7.4-alpine
npm run test:redis
npm run test:lifecycle
docker stop trafficbot-test-redis
docker build --no-cache --platform linux/amd64 -t trafficbot:test .
```

Browser tests use only a controlled local HTTP server. Browser/Redis/process suites are explicitly skipped in the default unit run; their dedicated commands fail on missing infrastructure, rather than converting setup failures to passes. CI runs all three integration suites. Legacy fingerprint/search demo scripts may contact external sites and are not verification gates. Use them only intentionally against authorized targets.

Generated profiles, dependencies, logs, and environment files must not be committed; the lockfile must be tracked. `check:artifacts` runs in CI. See [AUDIT.md](AUDIT.md) for the audit findings, dependency exposure, and verification evidence. Historical tracked profile data remains in Git history; removing it from the index does not erase prior exposure.

## License

MIT
