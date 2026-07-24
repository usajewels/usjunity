# MXSuite — Claude Context File

> This file restores context for Claude Code sessions. Read this first when starting a new session.

## Who You're Working With

Danny — the project owner and architect. He's building MXSuite to automate data migrations for GrowthZone and MemberSuite (association management platforms). He works with a contractor named Chris who has an existing manual migration pipeline (Snowflake → Python → SQL Server). The long-term goal is to replace Chris's manual pipeline with MXSuite's automated approach.

## What MXSuite Is

An **AI-native data migration platform** that helps coaches (non-engineers) migrate customer data from legacy AMS platforms (iMIS, Fonteva, Dynamics 365, YourMembership, Aptify) into GrowthZone or MemberSuite. The platform automates the migration workflow: upload source data → extract schema → AI-assisted field mapping → coach review/approval → data transformation → load into target system.

## Repository Layout

All repos live under `D:\growthzone\`:

### Backend
| Repo | Purpose |
|------|---------|
| `mxsuite-api/` | Spring Boot 3.3.5 REST API (Java 21) — the main backend |
| `mxsuite-parent/` | Maven parent POM / Bill of Materials |

### Frontend (pnpm monorepo)
| Repo | Purpose |
|------|---------|
| `mxsuite-shell/` | Main app container (umi.js micro-frontend host) |
| `mxsuite-admin/` | Admin dashboard |
| `mxsuite-planner/` | Coach planning/onboarding interface — **most active frontend** |
| `mxsuite-workspaces/` | Workspace management |
| `mxsuite-chat/` | Chat/messaging |
| `mxsuite-onboarding/` | Onboarding flows |
| `mxsuite-ui/` | UI component library |
| `mxsuite-shared/` | Shared types, API client, hooks, theme (all frontends depend on this) |

### Documentation & Data
| Path | Purpose |
|------|---------|
| `danny/doc/` | Architecture docs, gap analysis, onboarding process docs |
| `danny/doc/onboarding-current-state/docs/` | 6-part detailed onboarding documentation |
| `sample-data/` | Test data including `SampleTenantDB.bak` |
| `docs/` | Generated docs, coach docs, platform docs |

### Key Config Files
- `pnpm-workspace.yaml` — frontend monorepo config
- `docker-compose.yml` / `docker-compose.dev.yml` — infrastructure (Postgres, Redis)
- `mxsuite-api/src/main/resources/application.yml` — all backend config

## Tech Stack

**Backend:** Java 21, Spring Boot 3.3.5, PostgreSQL 16, Redis 7, JWT auth, Flyway migrations
**Frontend:** React 18, TypeScript 5.5, Vite, Ant Design 5, pnpm workspaces, Axios
**AI:** Anthropic (Claude, for auto-mapping), Groq (Llama, for chat), Grok (xAI)
**Infrastructure:** Docker Compose for Postgres/Redis, SQL Server Express via Docker for .bak files

## Architecture Overview

```
Browser → mxsuite-shell (micro-frontend host)
            ├── mxsuite-planner (coach onboarding UI)
            ├── mxsuite-admin (admin dashboard)
            ├── mxsuite-workspaces
            ├── mxsuite-chat
            └── mxsuite-onboarding
                    ↓
              mxsuite-api (Spring Boot)
                ├── PostgreSQL (app state, mappings, projects, tenants)
                ├── Redis (sessions, caching)
                ├── SQL Server Express via Docker (temp .bak restore)
                └── AI providers (Anthropic, Groq, Grok)
```

## Key Backend Files

### Controllers (in `mxsuite-api/src/main/java/com/mxsuite/controller/`)
- **`TenantOnboardingController.java`** — The main upload/mapping/import workflow. Handles CSV, Excel, and .bak uploads. Most actively developed controller.
- `FileUploadController.java` — Generic file upload with content-type validation
- `FieldMappingController.java` — CRUD for field mappings
- `AdminOnboardingController.java` — Admin view of onboarding projects

### Services (in `mxsuite-api/src/main/java/com/mxsuite/service/`)
- **`BakFileService.java`** — SQL Server .bak restore → schema extraction → cleanup
- `FileParsingService.java` — CSV/Excel parsing, schema extraction
- `AiMappingService.java` — AI-powered auto-mapping (calls Anthropic Claude)
- `BatchImportService.java` — Chunked data import
- `MappingVersionService.java` — Version history for mappings
- `TargetSchemaService.java` — Target schema definitions (GrowthZone/MemberSuite)

### Config (in `mxsuite-api/src/main/java/com/mxsuite/config/`)
- `MssqlProperties.java` — SQL Server connection config (host, port, credentials, paths)
- `AnalyticsProperties.java` — Phase threshold config

### Target Schemas (in `mxsuite-api/src/main/resources/`)
- `default-target-schema.json` — MemberSuite target schema
- `growthzone-target-schema-v2.json` — GrowthZone target schema

## Key Frontend Files

### Planner (most active frontend)
- **`mxsuite-planner/src/pages/tenant-onboarding/TenantUploadPage.tsx`** — File upload page (CSV, Excel, .bak). Handles sheet selection, table selection, SQL Server error recovery.
- `mxsuite-planner/src/services/tenantOnboardingApi.ts` — API client for onboarding endpoints

### Shared
- `mxsuite-shared/src/types/index.ts` — All shared TypeScript types/interfaces
- `mxsuite-shared/src/api/` — Axios HTTP client setup

## Current State of .bak File Support

### What's Built
1. **Upload pipeline** — accepts .bak files via HTTP upload or server file path
2. **BakFileService** — restores .bak to temp SQL Server DB, extracts INFORMATION_SCHEMA, drops temp DB
3. **Multi-entity schema** — each SQL table becomes an ENTITY node with FIELD children (vs flat CSV headers)
4. **Table selection** — coach can select which tables to map (analogous to Excel sheet selection)
5. **Graceful SQL Server unavailability** — if SQL Server is down, file is stored and user can retry via "Re-extract Schema" button
6. **Docker-ready dual paths** — `backup-restore-path` (host side for Java file copy) and `backup-restore-path-sql` (container side for SQL RESTORE commands)

### Configuration (application.yml)
```yaml
mxsuite:
  mssql:
    host: ${MSSQL_HOST:localhost}
    port: ${MSSQL_PORT:1433}
    username: ${MSSQL_USER:sa}
    password: ${MSSQL_PASSWORD:}
    backup-restore-path: ${MSSQL_BACKUP_PATH:C:/temp/mxsuite-backups}
    backup-restore-path-sql: ${MSSQL_BACKUP_PATH_SQL:/var/backups}
```

### Docker Setup for SQL Server
```bash
docker run -d --name mxsuite-mssql \
  -e ACCEPT_EULA=Y \
  -e MSSQL_SA_PASSWORD=MxSuite2024! \
  -p 1433:1433 \
  -v C:/temp/mxsuite-backups:/var/backups \
  mcr.microsoft.com/mssql/server:2022-latest
```

### What's NOT Built Yet
The .bak pipeline currently extracts **schema only** (table/column structure). The next phases are:

1. **Data profiling** — keep temp DB alive longer, pull sample values per column (TOP 5 distinct), row counts per table
2. **Transformation engine** — generate executable SQL from approved mappings, run against temp DB
3. **Target loading** — bulk insert transformed data into target MS SQL Server (GrowthZone or MemberSuite)
4. **Reconciliation** — post-load row count comparison, FK integrity checks

## Chris's Existing Pipeline (Being Replaced)

Chris has a working but manual migration pipeline:
```
Source data → Snowflake (staging/profiling) → Python loaders → Remote MS SQL Server (target)
```

- **Snowflake** is used for ad-hoc staging and data profiling — expensive, requires engineer knowledge
- **Python loaders** are hand-written per tenant — not reusable
- **Docker/SQL Express** is only used as an optional reconciliation tool, never in the critical path
- **Two write surfaces**: Direct SQL Server writes (fast, bulk) and MemberSuite REST/DataSuite API (for NoSQL/app layer entities)
- **Two SQL Server targets**: GZ-prod DB101 (Kerberos/Trusted Connection) and import server DB152 (SQL login AgentDev)

**The goal**: MXSuite replaces Snowflake as the staging/profiling layer and automates the Python loader work, so coaches (not engineers) drive migrations.

## Source System Playbooks

The platform encodes migration knowledge for known source systems:

| Source | Recognition | Status |
|--------|------------|--------|
| iMIS | `Name_Address`, `Activity` tables | Planned |
| Fonteva | `ORDERAPI_`, `EVENTAPI_`, `FS_` prefixes | `/source-fonteva` skill |
| Dynamics 365 | `ACCOUNTS`, `CONTACTS`, `COBALT_*` tables | `/source-d365` skill |
| YourMembership | YM-shaped exports | `/source-yourmembership` skill |

**Known traps**: D365 epoch date corruption (Unix seconds misread as microseconds), D365 missing FK proposals, Fonteva dedup discipline (243 duplicate memberships on RNG).

## Development Workflow

### Starting the Backend
```bash
cd D:\growthzone\mxsuite-api
mvn spring-boot:run
```
Runs on port 8080. Requires PostgreSQL and Redis (via Docker Compose).

### Starting the Frontend
```bash
cd D:\growthzone
pnpm install
pnpm --filter @mxsuite/planner dev    # planner on port 3001
pnpm --filter @mxsuite/admin dev      # admin on port 3002
pnpm --filter @mxsuite/shell dev      # shell on port 3000
```

### Building Shared Library
```bash
pnpm --filter @mxsuite/shared build   # must rebuild after type changes
```

### API Logs
The Spring Boot console output shows all request/response logging. Check for SQL Server connection errors when testing .bak uploads.

## Important Patterns

1. **UploadResultDto** — the standard response from upload endpoints. Key fields: `id`, `originalFilename`, `headers`, `previewRows`, `totalRows`, `needsSheetSelection`, `sheets`, `needsTableSelection`, `tables`, `sqlServerError`
2. **SourceSchemaNode** — tree structure for source data. ENTITY nodes contain FIELD children. Used for both flat files (single entity) and .bak files (multi-entity).
3. **MappingStatus** — `UNMAPPED` → `SUGGESTED` (AI) → `MAPPED` (coach approved) → `REJECTED`
4. **Project** — each tenant onboarding is a Project with phases: DISCOVER → MAP → GENERATE → DRY_RUN → MIGRATE → CUT_OVER

## Known Issues / Gotchas

1. SQL Server Express is NOT installed natively on the dev machine — use Docker
2. The API process sometimes can't be killed via `taskkill` (Access Denied) — restart manually or use Task Manager
3. When modifying shared types (`mxsuite-shared/src/types/index.ts`), rebuild shared library before testing frontend
4. TypeScript cast issue: `data as Record<string, unknown>` fails on UploadResultDto — use `data as unknown as Record<string, unknown>`
5. The `MSSQL_PASSWORD` env var must be set for SQL Server connection — default is empty which won't work with Docker
