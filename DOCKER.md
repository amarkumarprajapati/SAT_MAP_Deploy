# Deployment

The repository root `compose.yaml` runs the Next.js frontend in development mode with the frontend directory mounted into the container. Next.js hot reload applies source edits without rebuilding the image. The FastAPI backend also runs with automatic reload and owns the live AIS connections and persistence. The OSINT service and MySQL database run alongside it. Do not run the standalone `ais_db` recorder while this backend is running; both processes would subscribe to the same AIS feeds and write duplicate updates to MySQL.

## Configure and start

Copy `.env.example` to `.env` in the repository root. Set the same strong password for `DATABASE_PASSWORD` and `MYSQL_PASSWORD`, set a separate `MYSQL_ROOT_PASSWORD`, and add provider API keys if needed. Compose uses that one file for deployment settings.

```sh
docker compose up -d --build
```

Start the stack once with `docker compose up -d --build`. After that, edit files normally; frontend edits hot reload in the browser and backend Python edits reload automatically. Use `docker compose ps` or `docker compose logs -f frontend backend` to inspect the services.

If frontend dependencies change in `package.json` or `package-lock.json`, run `docker compose exec frontend npm ci` to refresh the mounted dependency volume. Backend dependency changes require `docker compose build backend` followed by `docker compose up -d backend`.

Open `http://localhost:7890` for the app. MySQL is available to tools on the Compose network at host `mysql`, port `3306`; connect with the `MYSQL_USER` and `MYSQL_PASSWORD` values from the root `.env` and select `MYSQL_DATABASE`. The database persists in the `mysql_data` volume. The previous SQLite snapshots are imported automatically the first time MySQL starts with an empty snapshots table.

## Operations

```sh
docker compose up -d --build
docker compose logs -f backend frontend
docker compose down
```

Use `docker compose down -v` only when you intend to delete the database volume and its data. This also removes the frontend dependency and Next.js cache volumes.

## Local development without Docker

Run the frontend with `npm run dev` from `SAT_MAP_Frontend`. Run the backend with `python run.py --reload` from `SAT_MAP_Backend`. Both applications read configuration from the repository root `.env`.
