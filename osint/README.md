# OSINT Producer – NestJS Backend

NestJS OSINT ingestion service. FastAPI calls its REST endpoints and presents the OSINT data to the frontend.

## Data flow

`Frontend → FastAPI → NestJS OSINT REST API`. RabbitMQ is not required.

### Payload Model

```json
{
  "id": "uuid",
  "title": "string (required)",
  "description": "string",
  "event_type": "TROOP_MOVEMENT | CYBER_ATTACK | POLITICAL | NATURAL_DISASTER | MILITARY_BUILDUP | INTEL_ALERT | OTHER",
  "source_link": "string",
  "confidence_level": "LOW | MEDIUM | HIGH",
  "country": "string",
  "latitude": 48.3794,
  "longitude": 38.0264,
  "raw_payload": {},
  "created_at": "ISO-8601"
}
```

## Quick Start

```bash
# Install
npm install

# Copy env
cp .env.example .env

# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Endpoints

### `GET /osint/news`

Fetch news and return each article with **latitude / longitude** resolved from that article’s own text (OpenStreetMap Nominatim). No hardcoded places. Search keyword is optional and is never used for coordinates.

**Examples:**
- `GET /osint/news?limit=5` — top world news
- `GET /osint/news?q=ukraine&limit=5` — keyword search (coords still come from each article)

**Response:**

```json
{
  "success": true,
  "total": 5,
  "articles": [
    {
      "title": "...",
      "description": "...",
      "link": "https://...",
      "source": "Reuters",
      "published_at": "2026-08-04T10:00:00.000Z",
      "latitude": 23.685,
      "longitude": 90.3563
    }
  ]
}
```

### `POST /osint/news/publish`

Ingest the latest articles in the OSINT service (includes coordinates).

```json
{
  "limit": 5
}
```

### `POST /osint/publish`

Publish an OSINT event.

**Request body example:**

```json
{
  "title": "Troop movement detected near border region",
  "description": "Satellite imagery shows deployment of 3 new armored columns.",
  "event_type": "TROOP_MOVEMENT",
  "source_link": "https://liveuamap.com",
  "confidence_level": "HIGH",
  "country": "Ukraine",
  "latitude": 48.3794,
  "longitude": 38.0264,
  "raw_payload": {
    "scraped_at": "2026-08-04T06:00:00Z",
    "engine": "NestJS-OSINT-V1"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "OSINT event stored in OSINT service",
  "payload": { ... }
}
```

### `GET /osint/status`

Returns OSINT polling and in-memory cache status.

### `GET /osint/schema`

Returns the expected payload schema and an example.

### `GET /health`

Simple health check.

## Environment Variables

| Variable        | Default                                              |
|-----------------|------------------------------------------------------|
| `PORT`          | `3000`                                               |

## Project Structure

```
src/
├── dto/
│   └── osint-event.dto.ts      # Validation DTOs & enums
├── osint/
│   ├── osint.module.ts
│   ├── osint.controller.ts     # REST endpoints
│   └── osint.service.ts
├── app.module.ts
├── app.controller.ts
├── app.service.ts
└── main.ts
```
