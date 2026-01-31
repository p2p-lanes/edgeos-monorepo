# EdgeOS

A multi-tenant SaaS platform for event management with a FastAPI backend and React-based backoffice dashboard.

## Overview

EdgeOS provides a complete solution for managing events (called "popups"), attendees, applications, payments, and more. It features:

- **Multi-Tenant Architecture**: PostgreSQL Row-Level Security (RLS) ensures complete data isolation between tenants
- **Role-Based Access Control**: SUPERADMIN, ADMIN, and VIEWER roles with granular permissions
- **Passwordless Authentication**: Secure email-based login with 6-digit codes
- **RESTful API**: Full-featured API with auto-generated OpenAPI documentation
- **Modern Frontend**: React 19 dashboard with TanStack Router and Query

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Backoffice (React)                    │
│                    localhost:5173 (dev)                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                        │
│                    localhost:8000                           │
├─────────────────────────┬───────────────────────────────────┤
│   API Routes            │   Core Services                   │
│   • /v1/auth            │   • JWT Authentication            │
│   • /v1/tenants         │   • Email Service                 │
│   • /v1/popups          │   • File Storage (S3)             │
│   • /v1/applications    │   • Tenant Connection Manager     │
│   • /v1/payments        │                                   │
│   • /v1/...             │                                   │
└─────────────────────────┴───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL with RLS                          │
│                    localhost:5432                           │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │  Tenant A   │  │  Tenant B   │  │  Tenant C   │        │
│   │  (isolated) │  │  (isolated) │  │  (isolated) │        │
│   └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start (Self-Hosting)

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [uv](https://docs.astral.sh/uv/) (for Python backend development)
- [Bun](https://bun.sh/) (for frontend development)

### 1. Clone and Configure

```bash
git clone <repository-url>
cd EdgeOS

# Copy environment template and configure
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` with your settings:

```bash
# Required
PROJECT_NAME=EdgeOS
DOMAIN=localhost

# Database
POSTGRES_SERVER=db
POSTGRES_USER=edgeos
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=edgeos

# Security
SECRET_KEY=<generate-with: openssl rand -hex 32>

# Initial Superadmin
SUPERADMIN=admin@yourdomain.com
SUPERADMIN_PASSWORD=<initial-password>

# Email (optional but recommended)
SMTP_HOST=smtp.example.com
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=<smtp-password>
EMAILS_FROM_EMAIL=noreply@yourdomain.com

# Frontend
VITE_API_URL=http://localhost:8000
```

### 3. Start Services

```bash
# Development mode with hot reload
docker compose watch

# Or production mode
docker compose up -d
```

### 4. Access the Application

- **Backoffice Dashboard**: http://localhost:5173
- **API Documentation**: http://localhost:8000/docs
- **API ReDoc**: http://localhost:8000/redoc

Login with the superadmin credentials you configured.

## Database Structure

### Core Entities

| Entity | Description |
|--------|-------------|
| **Tenants** | Organizations with isolated data and database credentials |
| **Users** | Backoffice users (SUPERADMIN, ADMIN, VIEWER roles) |
| **Humans** | End-users/attendees who apply to events |
| **Popups** | Events that humans can apply to |
| **Applications** | Human applications to specific popups |
| **Attendees** | Approved applications become attendees |
| **Products** | Items/tickets that can be purchased for popups |
| **Payments** | Payment records for applications |
| **Groups** | Group registrations for events |
| **Coupons** | Discount codes for popups |
| **FormFields** | Custom form fields per popup |

### Entity Relationships

```
Tenant
├── Users (backoffice access)
├── Humans (end-users)
├── Popups
│   ├── Products
│   ├── Coupons
│   ├── FormFields
│   ├── Groups
│   ├── ApprovalStrategy
│   └── PopupReviewers
├── Applications
│   ├── ApplicationReviews
│   ├── Attendees
│   │   └── AttendeeProducts
│   └── Payments
│       └── PaymentProducts
└── Groups
    ├── GroupLeaders
    ├── GroupMembers
    └── GroupProducts
```

### Row-Level Security (RLS)

All tenant-scoped tables include a `tenant_id` column with RLS policies that ensure:
- Data is automatically filtered by the current tenant
- Users cannot access data from other tenants
- Superadmins can bypass RLS for cross-tenant operations

## Project Structure

```
EdgeOS/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/            # API modules (router, crud, models, schemas)
│   │   ├── core/           # Configuration, database, security
│   │   ├── services/       # Email, storage services
│   │   ├── alembic/        # Database migrations
│   │   └── templates/      # Email templates
│   └── tests/              # Backend tests
├── backoffice/             # React frontend
│   └── src/
│       ├── routes/         # TanStack Router pages
│       ├── components/     # React components
│       ├── client/         # Auto-generated API client
│       ├── hooks/          # Custom React hooks
│       └── contexts/       # React contexts
├── compose.yaml             # Docker Compose configuration
└── .env                    # Environment variables
```

## Development

### Backend Development

```bash
cd backend

# Install dependencies
uv sync
source .venv/bin/activate

# Run development server
fastapi dev app/main.py

# Run tests
bash scripts/test.sh

# Lint and format
bash scripts/lint.sh
bash scripts/format.sh
```

### Frontend Development

```bash
cd backoffice

# Install dependencies
bun install

# Run development server
bun run dev

# Regenerate API client (after backend changes)
bun run generate-client

# Lint
bun run lint
```

### Database Migrations

```bash
# Inside backend container
docker compose exec backend bash

# Create a new migration
alembic revision --autogenerate -m "Description of changes"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PROJECT_NAME` | Yes | Application name |
| `DOMAIN` | Yes | Primary domain |
| `POSTGRES_SERVER` | Yes | Database host (`db` for Docker) |
| `POSTGRES_USER` | Yes | Database username |
| `POSTGRES_PASSWORD` | Yes | Database password |
| `POSTGRES_DB` | Yes | Database name |
| `SECRET_KEY` | Yes | JWT signing key (32+ hex chars) |
| `SUPERADMIN` | Yes | Initial superadmin email |
| `SUPERADMIN_PASSWORD` | Yes | Initial superadmin password |
| `SMTP_HOST` | No | SMTP server for emails |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `EMAILS_FROM_EMAIL` | No | From address for emails |
| `VITE_API_URL` | Yes | Backend URL for frontend |
| `S3_BUCKET` | No | S3 bucket for file uploads |
| `AWS_ACCESS_KEY_ID` | No | AWS credentials for S3 |
| `AWS_SECRET_ACCESS_KEY` | No | AWS credentials for S3 |
| `SENTRY_DSN` | No | Sentry DSN for error tracking |

### Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `backend` | 8000 | FastAPI application |
| `backoffice` | 5173 (dev) / 80 (prod) | React dashboard |
| `db` | 5432 | PostgreSQL database |
| `prestart` | - | Runs migrations before backend |

## API Documentation

Once running, the API documentation is available at:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI JSON**: http://localhost:8000/api/v1/openapi.json

### Authentication

The API uses JWT tokens. Authenticate via:

1. `POST /v1/auth/login` - Send email to receive login code
2. `POST /v1/auth/verify` - Verify code and receive JWT token
3. Include token in requests: `Authorization: Bearer <token>`

### Multi-Tenant Headers

For tenant-scoped endpoints:
- ADMIN/VIEWER users: Tenant derived from user's `tenant_id`
- SUPERADMIN users: Must provide `X-Tenant-Id` header

## User Roles

| Role | Permissions |
|------|-------------|
| **SUPERADMIN** | Full system access, manage tenants and users across all tenants |
| **ADMIN** | Full CRUD within their tenant, can create ADMIN/VIEWER users |
| **VIEWER** | Read-only access within their tenant |

## Additional Setup Steps

### Email Configuration

For passwordless authentication to work, configure SMTP settings. For development, you can use services like:
- [Mailpit](https://github.com/axllent/mailpit) (local testing)
- [Mailtrap](https://mailtrap.io/) (dev/staging)
- [SendGrid](https://sendgrid.com/), [AWS SES](https://aws.amazon.com/ses/) (production)

### File Storage (Optional)

For file uploads (e.g., attendee photos), configure S3-compatible storage:
- AWS S3
- MinIO (self-hosted)
- DigitalOcean Spaces
- Cloudflare R2

### Production Deployment

For production:

1. Use a managed PostgreSQL database (AWS RDS, DigitalOcean, etc.)
2. Set up proper SSL/TLS certificates
3. Configure a reverse proxy (nginx, Traefik, Caddy)
4. Set up monitoring and logging (Sentry, CloudWatch, etc.)
5. Use strong, unique passwords and secrets
6. Enable database backups

## License

See [LICENSE](LICENSE) file for details.
