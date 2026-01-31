# Release Notes

## v0.1.0 - Initial Release (2026-01-30)

### Overview

First release of EdgeOS, a multi-tenant SaaS platform with a FastAPI backend and React backoffice dashboard.

### Features

#### Backend
- **Multi-tenant architecture** with PostgreSQL Row-Level Security (RLS) for data isolation
- **Authentication system** with passwordless login (email codes) for both backoffice users and end-users (humans)
- **Role-based access control**: SUPERADMIN, ADMIN, VIEWER roles
- **Tenant management** with isolated database credentials per tenant
- **Core domain models**:
  - Popups (events)
  - Products with categories
  - Coupons
  - Groups
  - Applications with approval workflow
  - Attendees
  - Payments
  - Custom form fields
- **Email service** with Jinja2 templates
- **S3-compatible file uploads** (MinIO for local dev)
- **Database migrations** with Alembic

#### Backoffice (Dashboard)
- **React 19** with TypeScript
- **TanStack Router** for file-based routing
- **TanStack Query** for data fetching and caching
- **shadcn/ui** components with Tailwind CSS
- **Auto-generated OpenAPI client** from backend schema
- **Dark/light theme** support
- **Workspace context** for popup selection

#### Infrastructure
- **Docker Compose** configuration:
  - Production: backend + backoffice services
  - Development: adds PostgreSQL, Adminer, MinIO
- **Pre-commit hooks** for code quality (ruff, biome)
- **Utility scripts** for testing and client generation

### Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | FastAPI, SQLModel, PostgreSQL |
| Frontend | React 19, Vite, TypeScript |
| Styling | Tailwind CSS, shadcn/ui |
| State | TanStack Query, TanStack Router |
| Database | PostgreSQL 17 with RLS |
| Auth | JWT tokens, passwordless |
| Storage | S3-compatible (MinIO/AWS) |
| Container | Docker, Docker Compose |

### Getting Started

```bash
# Start all services with hot reload
docker compose watch

# View logs
docker compose logs -f backend
```

See [README.md](README.md) for detailed setup instructions.
