# Deployment

The repository root `compose.yaml` runs the Next.js frontend in production mode, so it does not open the Next.js development HMR WebSocket. The FastAPI backend runs with automatic reload. The OSINT service and MySQL database run alongside them.

## Configure and start

Copy `.env.example` to `.env` in the repository root. Set the same strong password for `DATABASE_PASSWORD` and `MYSQL_PASSWORD`, set a separate `MYSQL_ROOT_PASSWORD`, and add provider API keys if needed. Compose uses that one file for deployment settings.

```sh
docker compose watch
```

`docker compose watch` stays in the foreground while it watches files. In another terminal, use `docker compose ps` or `docker compose logs -f frontend backend` to inspect the services.

Compose Watch rebuilds and restarts the frontend when its source changes. Backend Python changes restart Uvicorn automatically through the source mount. If frontend dependencies change, Compose rebuilds the image; backend dependency changes require rebuilding the backend image. To run detached without source watching, use `docker compose up -d --build`.

Open `http://localhost:7890` for the app. MySQL is available to tools on the Compose network at host `mysql`, port `3306`; connect with the `MYSQL_USER` and `MYSQL_PASSWORD` values from the root `.env` and select `MYSQL_DATABASE`. The database persists in the `mysql_data` volume. The previous SQLite snapshots are imported automatically the first time MySQL starts with an empty snapshots table.

## Operations

```sh
docker compose up -d --build
docker compose logs -f backend frontend
docker compose down
```

Use `docker compose down -v` only when you intend to delete the database volume and its data.

## Local development without Docker

Run the frontend with `npm run dev` from `SAT_MAP_Frontend`. Run the backend with `python run.py --reload` from `SAT_MAP_Backend`. Both applications read configuration from the repository root `.env`.
