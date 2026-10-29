# SAT Map (LTMap) — Project Overview

**SAT Map** is a multi-domain geospatial intelligence (GEOINT / OSINT) platform available as both a web application and a standalone Windows desktop app. It aggregates and visualizes real-time tracking for **satellites**, **live commercial & tactical flights**, **maritime vessel movements (AIS)**, and **geocoded OSINT intelligence alerts** onto an interactive 2D/3D tactical map interface.

---

## 🏛️ System Architecture

The application comprises three core sub-services packaged into a single desktop application via Electron:

```
                      ┌──────────────────────────────────────┐
                      │    Desktop Shell (Electron)          │
                      │  [Port 7890 / 8569 / 15673 Manager]  │
                      └──────────────────┬───────────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
      ┌─────────────────────┐ ┌─────────────────────┐ ┌──────────────────────┐
      │  SAT_MAP_Frontend   │ │   SAT_MAP_Backend   │ │        osint         │
      │  (Next.js / React)  │ │   (Python FastAPI)  │ │   (NestJS / Node)    │
      │                     │ │                     │ │                      │
      │ • MapLibre GL 3D/2D │ │ • Satellite / TLE   │ │ • RSS / Intel Feeds  │
      │ • Satellite.js math │ │ • AIS Maritime      │ │ • Text Geocoding     │
      │ • Graph visualizer  │ │ • Flight radars     │ │ • Event classification│
      │ • Port 7890         │ │ • Port 8569         │ │ • Port 15673         │
      └─────────────────────┘ └──────────┬──────────┘ └──────────▲───────────┘
                                         │                       │
                                         └───────────────────────┘
```

---

## 📦 Core Components & Tech Stack

### 1. `SAT_MAP_Frontend` (Client UI & Map Visualization)
* **Framework**: Next.js 16 (App Router), React 19, TypeScript.
* **Styling & Components**: Tailwind CSS v4, Ant Design, Lucide Icons, Framer Motion.
* **Geospatial & Mapping**:
  * **MapLibre GL & React Map GL**: Custom vector tile styles (`dark-matter-style.json`), high-performance WebGL rendering.
  * **`satellite.js`**: Client-side SGP4/SDP4 orbit propagation, footprint calculation, and ground track generation.
* **Charts & Media**:
  * **Lightweight Charts**: Telemetry and financial/signal timeseries.
  * **React Force Graph 2D**: Entity link analysis and intelligence relation graphs.
  * **HLS.js**: Live surveillance video feeds.
* **Default Port**: `7890`

### 2. `SAT_MAP_Backend` (Telemetry & Aggregation Service)
* **Framework**: Python 3.10+, FastAPI, Uvicorn, AsyncPG.
* **Key Modules**:
  * **Satellites**: Automated TLE (Two-Line Element) cache updates and orbit calculations.
  * **Maritime (AIS)**: Live vessel tracking streams via WebSocket feeds (`ais_stream`, `digitraffic_ais`).
  * **Flights**: Real-time flight tracking aggregator.
  * **Database**: PostgreSQL connection pool for historical records, dossiers, and cached snapshot storage.
* **Default Port**: `8569`

### 3. `osint` (Intelligence Ingestion & Geocoding Engine)
* **Framework**: NestJS, Node.js, TypeScript, Axios, RxJS.
* **Key Capabilities**:
  * Scrapes and ingests news/intelligence feeds across categories (troop movements, cyber incidents, military buildups, natural disasters).
  * Performs automatic entity extraction and coordinate resolution (Latitude/Longitude) from unstructured article text using OpenStreetMap Nominatim.
  * Categorizes threats and assigns confidence levels (`LOW`, `MEDIUM`, `HIGH`).
* **Default Port**: `15673`

### 4. `electron-shell` & Standalone Installer
* **Wrapper**: Electron v33 + Electron Builder.
* **Behavior**: Launches Python backend, NestJS OSINT service, and Next.js frontend silently in the background, waits for ports to become active, and displays the frontend in a native desktop window.
* **Installer Format**: Windows 64-bit NSIS installer (`SAT Map Setup.exe`).

---

## 🚦 Ports & Environment Requirements

| Service | Port | Description |
| :--- | :--- | :--- |
| **Frontend** | `7890` | Next.js Web Interface / Map View |
| **Backend** | `8569` | FastAPI REST & WebSocket Server |
| **OSINT** | `15673` | NestJS Intelligence & Geocoding Service |
| **Database** | `5432` | PostgreSQL (Optional for snapshot persistence) |

---

## 🛠️ Development & Deployment

### Running Services Locally (Development)

1. **Frontend**:
   ```bash
   cd SAT_MAP_Frontend
   npm install
   npm run dev
   ```
2. **Backend**:
   ```bash
   cd SAT_MAP_Backend
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   python run.py
   ```
3. **OSINT Service**:
   ```bash
   cd osint
   npm install
   npm run start:dev
   ```

### Building the Standalone Windows Executable

Run the automated build script from PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```
* Output target: `SAT_Build\release\SAT Map Setup.exe`

