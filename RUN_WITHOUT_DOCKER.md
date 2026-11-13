# Running SAT Map Without Docker (Local Development)

This guide walks you through setting up and running the **Frontend**, **FastAPI Backend**, and optional **OSINT Ingestion Service** locally on Windows without Docker.

---

## 📋 Prerequisites

1. **Node.js**: v20 or newer (Run `node -v` to verify).
2. **Python**: 3.10+ (Run `python --version` to verify).
   > *Note for Windows users:* If `python` is not added to your system PATH, use:
   > ```powershell
   > "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
   > ```

---

## ⚙️ 1. Environment Configuration (`.env`)

The project root contains a [`.env`](.env) file. Because Docker defaults use container hostnames (`DATABASE_HOST=mysql`), adjust the settings for local execution:

```ini
APP_ENV=development
DATABASE_REQUIRED=false
DATABASE_HOST=
OSINT_SERVICE_URL=http://127.0.0.1:15673
CORS_ORIGINS=http://localhost:7890,http://127.0.0.1:7890
FASTAPI_URL=http://127.0.0.1:8569
```

> **Database Note**:
> When `DATABASE_REQUIRED=false` and `DATABASE_HOST` is left empty, the backend automatically uses a local **SQLite** file database (`data/sat_map.sqlite3`).
> If you have a local MySQL instance running, you can set `DATABASE_HOST=localhost` and provide your credentials instead.

---

## 🚀 2. Start the Backend (`SAT_MAP_Backend`)

Open **Terminal 1** (PowerShell):

```powershell
cd SAT_MAP_Backend

# 1. Create a virtual environment (first time only)
python -m venv .venv
# Or if python is not in PATH:
# & "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe" -m venv .venv

# 2. Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Start the FastAPI server
python run.py --reload
```

- **API Base URL**: `http://127.0.0.1:8569`
- **Health Check**: [http://127.0.0.1:8569/api/health](http://127.0.0.1:8569/api/health)
- **Interactive Swagger Docs**: [http://127.0.0.1:8569/docs](http://127.0.0.1:8569/docs)

---

## 🌐 3. Start the Frontend (`SAT_MAP_Frontend`)

For CARTO dark tiles, put `NEXT_PUBLIC_CARTO_BASEMAPS_KEY=your-key` in `SAT_MAP_Frontend/.env.local` before starting Next.js. The key is public in browser tile requests; restrict it from your CARTO Basemaps dashboard.

Open **Terminal 2** (PowerShell):

```powershell
cd SAT_MAP_Frontend

# 1. Install dependencies (first time only)
npm install

# 2. Start the Next.js development server
npm run dev
```

- **Web App URL**: [http://localhost:7890](http://localhost:7890)
- The frontend will automatically proxy backend requests (`/fastapi/*`) to `http://127.0.0.1:8569`.

---

## 🛰️ 4. (Optional) Start the OSINT Service (`osint`)

The OSINT service ingests live RSS intelligence feeds, categorizes threat levels, and geocodes coordinates.

Open **Terminal 3** (PowerShell):

```powershell
cd osint

# 1. Install dependencies (first time only)
npm install

# 2. Start NestJS service in watch mode
npm run start:dev
```

- **OSINT Service URL**: `http://127.0.0.1:15673` (or `http://127.0.0.1:3000` depending on configuration)

---

## 📌 Summary of Ports & Services

| Service | Technology | Port | Access URL |
| :--- | :--- | :--- | :--- |
| **Frontend** | Next.js 16 / React 19 | `7890` | [http://localhost:7890](http://localhost:7890) |
| **Backend** | Python FastAPI | `8569` | [http://localhost:8569](http://localhost:8569) |
| **OSINT** | NestJS | `15673` | [http://localhost:15673](http://localhost:15673) |

