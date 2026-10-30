# SAT_MAP (Frontend)

Interactive satellite, aviation, maritime, and global situational intelligence map dashboard built with Next.js, React, and MapLibre GL.

---

## Deployment

Use the repository root `compose.yaml` to build and run the frontend, backend, and OSINT service together. Configure the single repository root `.env` from `.env.example`, then run from the repository root:

```bash
docker compose up -d --build
docker compose logs -f frontend
```

Open [http://localhost:7890](http://localhost:7890). See the root `DOCKER.md` for deployment and persistence details.

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

For local development, run `npm run dev` from this directory.
