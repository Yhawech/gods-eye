# GOD EYE v2 OSINT Intelligence Dashboard

A cloud-ready OSINT dashboard for monitoring geopolitical reporting, military-related reporting, economic risk, cyber/security incidents, natural hazards, live aviation, and analyst intelligence reports.

The app uses FastAPI, MongoDB Atlas, DeepSeek-powered analysis, styled PDF report export, source credibility scoring, duplicate event grouping, dashboard analytics, and a richer saved report library.

## Run The Main App

```powershell
npm start
```

Open:

- Main dashboard: `http://localhost:4173`
- Threat intelligence v2: `http://localhost:4173/v2.html`
- Live aviation: `http://localhost:4173/traffic.html`
- 3D globe companion launcher: `http://localhost:4173/globe.html`

## Local Environment

Set these in your terminal or system environment before starting the main app:

```powershell
$env:MONGODB_URI="mongodb+srv://USER:PASSWORD@YOUR_CLUSTER.mongodb.net/gods_eye?retryWrites=true&w=majority&appName=YOUR_CLUSTER"
$env:MONGODB_DB="gods_eye"
$env:DEEPSEEK_API_KEY="your-deepseek-api-key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
npm start
```

For permanent Windows user variables, use `setx`, then close and reopen the terminal:

```cmd
setx MONGODB_URI "mongodb+srv://USER:PASSWORD@YOUR_CLUSTER.mongodb.net/gods_eye?retryWrites=true^&w=majority^&appName=YOUR_CLUSTER"
setx MONGODB_DB "gods_eye"
setx DEEPSEEK_API_KEY "your-deepseek-api-key"
```

Never commit real API keys, database passwords, or `.env` files.

## 3D Globe Companion

This project can run gods-eye-view-3D beside GOD EYE as a local 3D geospatial companion. GOD EYE stays on port `4173`; the globe companion runs on port `4174`.

```powershell
npm run setup:globe
npm run install:globe
npm run start:globe
```

After first setup, you can start both the main dashboard and globe together with:

```powershell
npm run start:full
```


`npm start` starts only the main dashboard on port `4173`.

Then open:

```text
http://localhost:4173/globe.html
```

The globe companion requires a Google Maps Platform key with Map Tiles API enabled. Put that key in:

```text
tmp/gods-eye-view/.env
```

DeepSeek remains the AI engine for GOD EYE chatbot responses and report generation.

## Live Sources

- USGS earthquake GeoJSON feeds
- NASA EONET active natural events
- NOAA/NWS active alerts
- GDACS disaster RSS
- Defense.gov RSS
- FEMA updates RSS
- Google News RSS/search feeds
- GDELT 2.1 Document API
- Shadowbroker-inspired source pack: BBC, NPR, Al Jazeera, Guardian, The War Zone, Bellingcat, Defense News, The Diplomat, SCMP, Yonhap, Asia Times, France 24, and DW
- OpenSky Network aircraft states
- Airplanes.live military aviation
- Globe Fleet & Defense Watch: recent public-source reporting on naval fleets, deployments, troop activity, missile tests, and major defense exercises
- Globe Geopolitical Watch: recent GDELT public-source reporting with regional attribution markers and direct source links

## MongoDB Collections

- `events` - stored OSINT events from live feeds
- `analyst_reports` - saved incident reports and PDF report source data
- `chat_messages` - analyst chatbot history
- `ioc_lookups` - optional legacy IOC lookup history
- `provider_results` - optional provider lookup history
- `counters` - app counters

## AWS Deployment

The GitHub Actions workflow verifies the app on push and supports manual deployment to AWS using:

GitHub Actions -> Amazon S3 -> AWS CodeDeploy -> Auto Scaling Group -> private EC2 instances -> Application Load Balancer -> Route 53/HTTPS.

Required GitHub Secrets:

- `MONGODB_URI`
- `DEEPSEEK_API_KEY`

Optional GitHub Secrets:

- `GOOGLE_MAPS_API_KEY` - required when `GLOBE_ENABLED=true`
- `FIRMS_MAP_KEY` - optional NASA FIRMS fire data
- `AISSTREAM_API_KEY` - optional live vessel data

The globe Fleet & Defense Watch and Geopolitical Watch feeds use the keyless GDELT DOC 2.0 public-news endpoint. They do not require a new GitHub secret. Reports are source-linked and regional, not an authoritative operational picture.

Required GitHub Variables:

- `AWS_REGION`
- `AWS_ROLE_TO_ASSUME`
- `S3_DEPLOY_BUCKET`
- `CODEDEPLOY_APP_NAME`
- `CODEDEPLOY_DEPLOYMENT_GROUP`
- `APP_SECRET_ID`
- `EC2_APP_DIR`
- `EC2_APP_HOST`
- `EC2_APP_PORT`
- `EC2_SERVICE_NAME`
- `EC2_RUN_USER`
- `MONGODB_DB`
- `MONGODB_TIMEOUT_MS`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_THINKING`
- `DEEPSEEK_REASONING_EFFORT`

Optional GitHub Variables:

- `GLOBE_ENABLED` - defaults to `false`; set to `true` only after Google Maps quotas and billing alerts are configured
- `GLOBE_REPO_URL` - defaults to `https://github.com/bilawalsidhu/gods-eye-view.git`
- `GLOBE_INSTALL_DIR` - defaults to `/opt/gods-eye/globe`
- `GLOBE_APP_HOST` - defaults to `0.0.0.0`
- `GLOBE_APP_PORT` - defaults to `4174`
- `GLOBE_VIEW_URL` - local default is `http://127.0.0.1:4174`; when enabled on AWS, set this to the public ALB/domain route
- `CCTV_MAX_SOURCES` - optional globe camera source cap, default `900`
- `CCTV_AUSTIN_MAX_SOURCES` - optional Austin camera cap, default `120`
- `CCTV_PREFER_AUSTIN` - optional camera preference flag, default `0`
- `GLOBE_OSINT_ENABLED` - defaults to `true` when the globe service is enabled
- `GLOBE_OSINT_REFRESH_MS` - public OSINT feed cache/refresh interval, default `300000`
- `GLOBE_OSINT_MAX_ITEMS` - maximum items per globe feed, default `80`

## Notes

- The AWS workflow deploys the main GOD EYE FastAPI dashboard. When `GLOBE_ENABLED=true`, the CodeDeploy hook runs `scripts/setup_globe.sh` on each EC2 instance.
- The hook clones the globe repository, applies the tracked GOD EYE patch scripts, installs Node dependencies, writes the globe `.env`, and creates the `gods-eye-globe` systemd service on private port `4174`.
- The globe companion is set up locally under `tmp/gods-eye-view`, which is intentionally ignored by Git; the repository only needs the setup and patch scripts.
- For AWS, expose the globe through an ALB host rule such as `globe.example.com` or a path rule, then set `GLOBE_VIEW_URL` to that public `http://` or `https://` URL. Never use `127.0.0.1` for an enabled public deployment.
- The main `/api/health` endpoint is a readiness check: it returns HTTP 200 only when MongoDB is connected and HTTP 503 otherwise. Configure the main ALB target group success code as `200`.

Street Traffic globe layer: removed because no reliable free live-global traffic feed is available; no traffic API key is required.