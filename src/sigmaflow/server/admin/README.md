# SigmaFlow Admin Module

This directory contains the integrated admin panel from the openai-agents-tracing project. It provides a complete management and tracing system for SigmaFlow pipelines.

## Architecture

### Backend (Python/FastAPI)
- `admin.py` - Main AdminAPI class with all route handlers
- `admin_models.py` - Pydantic models for request/response validation and storage models
- `admin_auth.py` - Authentication and authorization utilities (JWT, API keys, password hashing)
- `admin_storage.py` - In-memory storage layer (can be extended with database backend)

### Frontend (React/TypeScript)
Located in `src/` directory:
- `App.tsx` - Main React application with routing
- `api.ts` - API client with axios interceptors
- `types.ts` - TypeScript type definitions
- `components/` - React components for pages and UI
- `hooks/` - Custom React hooks
- `lib/` - Utility functions

## Setup

### 1. Install Python Dependencies

The admin module requires additional Python packages. Add these to your project dependencies:

```bash
pip install bcrypt python-jose
```

Or update `pyproject.toml`:
```toml
dependencies = [
    ...
    "bcrypt",
    "python-jose",
]
```

### 2. Build Frontend

The frontend needs to be built with Vite and the built files should be placed in `admin/dist/`.

```bash
cd src/sigmaflow/server/admin
npm install
npm run build
# This creates dist/ directory with built static files
```

The built files will be served from `/admin/` path.

### 3. Initialize First Admin User

On first startup, access the `/admin/initial-setup` route to create the initial admin user:

```
http://localhost:8000/admin/initial-setup
```

## API Endpoints

### Authentication Routes (`/admin/auth`)
- `GET /admin/setup-status` - Check if setup is completed
- `POST /admin/setup` - Initial setup (create first admin user)
- `POST /admin/login` - User login
- `POST /admin/create-user` - Create new user (admin only)

### Traces Routes (`/admin/traces`)
- `POST /admin/traces/event` - Submit trace and span events (API key auth)
- `GET /admin/traces` - List traces with filtering and pagination (JWT auth)
- `GET /admin/traces/{trace_id}` - Get single trace details (JWT auth)

### API Keys Routes (`/admin/api-keys`)
- `POST /admin/api-keys` - Create new API key (admin only)
- `GET /admin/api-keys` - List all API keys (admin only)
- `GET /admin/api-keys/{key_id}` - Get API key details (admin only)
- `DELETE /admin/api-keys/{key_id}` - Delete API key (admin only)

### Analytics Routes (`/admin/analytics`)
- `GET /admin/analytics/overview` - Get overview metrics (JWT auth)
- `GET /admin/analytics/time-series` - Get time series data (JWT auth)
- `GET /admin/analytics/models` - Get model breakdown (JWT auth)

## Frontend Routes

The admin frontend includes the following pages:

- `/` - Redirects to `/traces`
- `/traces` - List all traces with filtering
- `/trace/:id` - Detailed trace view with spans
- `/costs` - Cost analytics dashboard
- `/api-keys` - API key management
- `/setup` - User management
- `/login` - Login page
- `/initial-setup` - Initial setup page

## Data Models

### Trace
- `id`: Unique trace identifier
- `workflow_name`: Name of the workflow
- `group_id`: Optional group identifier
- `metadata`: Optional metadata dictionary
- `spans`: Associated span events
- `created_at`: Timestamp
- `updated_at`: Timestamp

### Span
- `id`: Unique span identifier
- `trace_id`: Reference to trace
- `parent_id`: Optional parent span
- `started_at`: Start timestamp
- `ended_at`: End timestamp
- `span_data`: Span-specific data (type, name, usage, etc.)
- `error`: Optional error information

### User
- `id`: User ID
- `email`: User email
- `role`: "ADMIN" or "READ_ONLY"
- `created_at`: Timestamp

### API Key
- `id`: Key ID
- `name`: Display name
- `prefix`: Key prefix (first 5 chars)
- `suffix`: Key suffix (last 2 chars)
- `expires_at`: Optional expiration date
- `created_by`: User ID of creator
- `is_active`: Whether key is active

## Authentication

### JWT Tokens
- Used for user authentication
- Default expiry: 1 day
- Token stored in localStorage as `auth_token`
- Sent in `Authorization: Bearer <token>` header

### API Keys
- Used for programmatic access (submitting traces/spans)
- Format: `ak_<24-character-random>`
- Hashed and stored for security
- Optional expiration dates
- Tracked for usage and access control

## Storage

Currently uses in-memory storage (AdminStorage class). For production use, extend with:
- SQLAlchemy ORM models
- Database backend (PostgreSQL, MySQL, etc.)
- Proper indexing for performance
- Transaction support

## Frontend Development

For local development of the frontend:

```bash
cd src/sigmaflow/server/admin
npm install
npm run dev
```

This will start a Vite dev server on `http://localhost:5173` with hot module reloading.

## Environment Variables

### Frontend (`.env` in admin directory)
- `VITE_API_URL` - Base URL for API (defaults to current origin)

### Backend
- `JWT_SECRET` - Secret key for JWT signing (defaults to 'default_jwt_secret_change_in_production')
- `BCRYPT_SALT_ROUNDS` - Number of salt rounds for password hashing (default: 10)

## Integration with SigmaFlow

The admin module is integrated into the main SigmaFlow server:

1. `AdminAPI` class is instantiated in `main.py`
2. Admin routes are included in the FastAPI app
3. Static files from `admin/dist/` are mounted at `/admin/`
4. Admin panel is accessible at `http://localhost:8000/admin/`

## Notes

- The admin storage is currently in-memory. For production, implement persistent storage
- API key hashing uses SHA-256. Consider upgrading to bcrypt for consistency
- Analytics endpoints are partially implemented and can be extended
- Frontend components use Tailwind CSS and shadcn/ui components
- The system supports multi-user with role-based access control
