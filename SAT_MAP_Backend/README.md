# LTmap FastAPI Backend

FastAPI backend powering the LTmap geospatial and OSINT dashboard. It combines live data feeds, SGP4 satellite propagation, AIS streams, and a MySQL store for durable data snapshots.

The browser calls FastAPI only. FastAPI reads OSINT news from the NestJS service at `OSINT_SERVICE_URL` and merges it into `/api/news`.

---

## Quick Start

### 1. Prerequisites
- **Python 3.10+**
- `pip` package manager
- Docker Compose from the repository root for deployment

### 2. Navigate to Backend Directory
```bash
cd backend
```

### 3. (Optional) Create & Activate a Virtual Environment
**Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**macOS / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```
*(On Windows with Python Launcher, you can also run: `py -3.10 -m pip install -r requirements.txt`)*

### 5. Configure Environment (`.env`)
Use the repository root `.env.example` as a template and keep one `.env` at the repository root. It configures the frontend, backend, OSINT service, and MySQL connection:
```env
APP_ENV=production
HOST=0.0.0.0
PORT=8569
BASE_URL=https://api.example.com
API_PREFIX=/api
CORS_ORIGINS=https://your-frontend.example.com

DATABASE_REQUIRED=true
DATABASE_HOST=mysql
DATABASE_PORT=3306
DATABASE_NAME=sat_map
DATABASE_USER=sat_map
DATABASE_PASSWORD=your-mysql-password
```
Keep `.env` private. The backend stores the latest TLE catalogue, flight feed, and news snapshots in MySQL. The named `mysql_data` volume keeps them across container restarts. Existing SQLite snapshots are imported when MySQL is empty.

---

## Running the Server

### Option A: Using Docker Compose (Recommended)
Make sure Docker Desktop is installed and running.

```bash
# 1. From the repository root, configure .env and start the application services
docker compose up -d --build

# 2. View real-time logs
docker compose logs -f

# 3. Check health and container status
docker compose ps

# 4. Stop the container
docker compose down
```

### Option B: Using `run.py` (Local Python)
```powershell
# Development mode
$env:APP_ENV = "development"
$env:DATABASE_REQUIRED = "false"
python run.py

# With hot-reload for active development
python run.py --reload
```
*(If using the Windows Python launcher: `py -3.10 run.py --reload`)*

### Option C: Using `uvicorn` Directly
```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

When started, you will see:
```text
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     AIS stream connected and subscribed
INFO:     Application startup complete.
```

In production, `APP_ENV=production` requires complete `DATABASE_*` settings, `DATABASE_REQUIRED=true`, and explicit non-wildcard `CORS_ORIGINS`. The API health endpoint reports database status and returns HTTP 503 if the required database is unavailable. Interactive API docs are disabled in production.

---

## Interactive Documentation & Testing

Once running, visit:
- **Swagger UI (Interactive API Explorer):** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc (Detailed API Specs):** [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health Check JSON:** [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

## API Endpoints Catalog

All endpoints are centrally registered in `app/endpoints.py` under the `/api` prefix:

| Endpoint | Method | Description | Third-Party Source |
| :--- | :---: | :--- | :--- |
| `/api/health` | `GET` | Health check, uptime, and endpoints registry | Local |
| `/api/flights` | `GET` | Live military aircraft positions, types & jamming hotspots | `adsb.fi` / OpenSky |
| `/api/maritime` | `GET` | Live AIS ship positions; port and chokepoint arrays are empty until a live geographic source is configured | `aisstream.io` WebSocket |
| `/api/satellites` | `GET` | All active satellites with real-time SGP4 orbital propagation | CelesTrak / SatNOGS |
| `/api/satellites/orbit` | `GET` | Full single-orbit trajectory trace or live telemetry | Local TLE Cache |
| `/api/proxy-tiles` | `GET` | CORS proxy for CartoDB / CartoCDN raster map tiles | `cartocdn.com` |
| `/api/region-dossier` | `GET` | OSINT dossier for coordinates: Reverse geocode, Wikidata & Wikipedia | Photon / Wikidata / Wikipedia |
| `/api/stats` | `GET` | High-level tracker counters (flights, satellites, maritime) | In-memory aggregations |

### Endpoint Details & Query Parameters

#### 1. Satellites Orbit (`/api/satellites/orbit`)
- `id` (required): NORAD Catalog ID (e.g. `25544` for ISS)
- `t` (optional): Anchor timestamp in milliseconds to center the orbit
- `live` (optional): Set to `1` for live telemetry (speed, heading, altitude)
- *Example:* `http://localhost:8000/api/satellites/orbit?id=25544&live=1`

#### 2. Region Dossier (`/api/region-dossier`)
- `lat` (required): Latitude float (e.g. `28.6139`)
- `lng` (required): Longitude float (e.g. `77.2090`)
- *Example:* `http://localhost:8000/api/region-dossier?lat=28.6139&lng=77.2090`

#### 3. Map Tile Proxy (`/api/proxy-tiles`)
- `url` (required): URL-encoded CartoCDN tile URL
- *Example:* `http://localhost:8000/api/proxy-tiles?url=https%3A%2F%2Fa.basemaps.cartocdn.com%2Fdark_all%2F0%2F0%2F0.png`

---

## Third-Party Data Sources & External APIs

For the exhaustive technical specification with field-level schemas, see **[DATA_SOURCES.md](DATA_SOURCES.md)**.

| Domain | 3rd-Party Provider | Protocol | What Data is Received & Processed |
| :--- | :--- | :--- | :--- |
| **Maritime (Global)** | **AISStream** (`aisstream.io`) | WebSocket (`wss://`) | **Live AIS vessel tracking:** MMSI, vessel name, coordinates, speed (SOG), heading (COG/TrueHeading), vessel type (cargo, tanker, military), destination. |
| **Maritime (Baltic / Nordic)** | **Fintraffic Digitraffic** (`digitraffic.fi`) | MQTT over TLS | **Public Finnish/Baltic AIS feed:** High-frequency location updates and vessel metadata, merged into the main in-memory ship registry without API keys. |
| **Military Flights & GPS Jamming** | **adsb.fi** | HTTPS REST | **Global airborne transponders:** ICAO24 hex, callsigns, airframe models, barometric altitude, ground speed, track heading. Backend classifies military aircraft & detects GPS jamming/spoofing hotspots (`nac_p <= 4`). |
| **Satellite Orbits (Primary)** | **CelesTrak** (`celestrak.org`) | HTTPS REST | **Two-Line Elements (TLEs):** 13 constellation groups (GPS, GLONASS, Galileo, BeiDou, Weather, Earth Resources, Planet Labs, Military Recon, Radar). Propagated locally using SGP4/SDP4 Keplerian orbital mechanics. |
| **Satellite Orbits (Fallback)** | **SatNOGS DB** (`satnogs.org`) | HTTPS REST | **Crowdsourced satellite TLE database:** Automated failover source if CelesTrak is unavailable or rate-limited. |
| **Reverse Geocoding** | **Photon by Komoot** (OpenStreetMap) | HTTPS REST | **Coordinate-to-location mapping:** Converts `lat, lng` to city, state, country, and ISO country code. |
| **Country Intelligence** | **Wikidata REST & Action APIs** | HTTPS REST | **Geopolitical facts:** Capital city, continent, official languages, currencies, head of state, national flag image URL, population, and land area. |
| **Regional Summary** | **Wikipedia REST API** | HTTPS REST | **Geographical overview:** Article synopsis (500 chars) and thumbnail image for the target region or capital. |

---

## Connecting the Frontend

The Next.js frontend (`SAT_MAP/`) connects automatically to this backend via:
```env
# In SAT_MAP/.env:
NEXT_PUBLIC_FASTAPI_URL=http://localhost:8000
```
All frontend requests are managed by the centralized client in `SAT_MAP/src/config/api.ts`.
