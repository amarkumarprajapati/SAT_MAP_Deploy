# SAT_MAP Docker development

The development container bind-mounts the project into `/app` and polls for file edits. Normal source changes should hot-reload in the browser without restarting Docker.

## Apply the watcher configuration

Rebuild and recreate the frontend once to apply the webpack polling configuration:

```bash
docker compose up -d --build frontend
```

Run this from the `SAT_MAP` directory. Keep the container running while editing.

## Changes that need a rebuild

Changing `.ts`, `.tsx`, `.css`, or other application source files should hot-reload automatically. Rebuild the frontend only after changing dependencies, the Dockerfile, Compose configuration, or Next.js configuration:

```bash
docker compose up -d --build frontend
```

## Logs and shutdown

```bash
docker compose logs -f frontend
docker compose down
```

The frontend joins the external `sat_map_backend_sat_map_net` network and uses the backend Compose service name, `http://backend:8000`, for server-side API requests. Recreate the frontend after changing its Compose environment:

```bash
docker compose up -d --force-recreate frontend
```
