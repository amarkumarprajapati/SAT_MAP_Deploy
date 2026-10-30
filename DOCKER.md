# Deployment

The repository root `compose.yaml` is the single Docker deployment setup for the Next.js frontend, FastAPI backend, OSINT service, and MySQL database.

## Configure and start

Copy `.env.example` to `.env` in the repository root. Set the same strong password for `DATABASE_PASSWORD` and `MYSQL_PASSWORD`, set a separate `MYSQL_ROOT_PASSWORD`, and add provider API keys if needed. Compose uses that one file for deployment settings.

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Open `http://localhost:7890` for the app. MySQL is available to tools on the Compose network at host `mysql`, port `3306`; connect with the `MYSQL_USER` and `MYSQL_PASSWORD` values from the root `.env` and select `MYSQL_DATABASE`. The database persists in the `mysql_data` volume. The previous SQLite snapshots are imported automatically the first time MySQL starts with an empty snapshots table.

## Operations

```sh
docker compose up -d --build
docker compose logs -f backend frontend
docker compose down
```

Use `docker compose down -v` only when you intend to delete the database volume and its data.

## Local development

Run the frontend with `npm run dev` from `SAT_MAP_Frontend`. Run the backend with `python run.py` from `SAT_MAP_Backend`. Both applications read configuration from the repository root `.env`.
