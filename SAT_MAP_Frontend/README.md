# SAT_MAP (Frontend)

Interactive satellite, aviation, maritime, and global situational intelligence map dashboard built with Next.js, React, and MapLibre GL.

---

## Architecture Overview

- **Frontend (`SAT_MAP`)**: Next.js 16 (App Router), React 19, MapLibre GL, Tailwind CSS. Runs on port `3000`.
- **Backend (`SAT_MAP_Backend`)**: FastAPI backend container running on port `8000` on Docker network `sat_map_backend_sat_map_net`.
- **API Proxy**: Frontend proxies `/api/*` and `/fastapi/*` requests directly to the FastAPI backend container (`http://sat_map_backend:8000`).

---

## Docker Setup with Live Hot-Reloading 🔥

The Docker configuration is configured with **live code reloading / hot-reloading (HMR)**. Any changes you make to your files (`src/`, `public/`, etc.) will **automatically update immediately** inside the running container without rebuilding or restarting.

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running.
- Backend container (`sat_map_backend`) running.

### 1. Start the Frontend Container
Start the container in the background:
```bash
docker compose up -d --build
```
> *(The `--build` flag is only needed on the very first start or whenever you install new npm packages in `package.json`)*.

### 2. Develop with Auto-Update
- Edit any code in your project (e.g. `src/app/page.tsx`).
- Next.js detects the file changes via Docker bind mounts and Fast Refresh updates the browser automatically.
- No need to run `docker compose build` or restart the container!

### 3. Useful Docker Commands
```bash
# View live application logs (see hot reloads in real time)
docker compose logs -f frontend

# Stop the container
docker compose down

# Rebuild only if you add new npm packages
docker compose up -d --build
```

Access the frontend at: [http://localhost:3000](http://localhost:3000)

---

## Local Development (Without Docker)

### Prerequisites
- Node.js 20 or 22+
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Command Cheat Sheet

| Command | Description |
|---|---|
| `docker compose up -d` | Start container with live hot-reload |
| `docker compose up -d --build` | Rebuild & start (run when adding new packages) |
| `docker compose logs -f` | View live logs & hot reload events |
| `docker compose down` | Stop container |
| `npm run dev` | Run locally without Docker |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest test suite |
