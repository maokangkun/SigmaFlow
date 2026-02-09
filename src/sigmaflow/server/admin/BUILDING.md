# Building the SigmaFlow Admin Frontend

This document explains how to build the admin frontend panel.

## Prerequisites

- Node.js 18+ and npm/pnpm
- The frontend source code is in `src/`
- Built files are output to `dist/`

## Build Steps

### 1. Install Dependencies

```bash
cd src/sigmaflow/server/admin
npm install
# or
pnpm install
```

### 2. Build for Production

```bash
npm run build
# or
pnpm build
```

This will:
1. Compile TypeScript code
2. Bundle React components
3. Optimize assets
4. Output to `dist/` directory

### 3. Verify Build

Check that the `dist/` directory contains:
- `index.html` - Main HTML file
- `assets/` - JavaScript, CSS, and other bundled assets
- The full directory structure is served as static files

## Development Mode

For local development with hot reload:

```bash
npm run dev
# or
pnpm dev
```

This starts a Vite dev server on `http://localhost:5173` with hot module replacement enabled.

## Integration with SigmaFlow

Once built, the frontend is automatically served:

1. FastAPI mounts `dist/` directory at `/admin` path
2. Access the admin panel at `http://localhost:8000/admin/`
3. All API calls go to `/admin/*` endpoints

## Troubleshooting

### Build Fails with Module Not Found

Ensure all dependencies are installed:
```bash
rm -rf node_modules pnpm-lock.yaml
npm install
```

### API Calls 404

Check that:
1. SigmaFlow backend is running on the same server
2. Admin API endpoints are properly registered in Python code
3. Frontend points to correct API base URL (should be relative to current origin)

### Frontend Not Loading

Verify:
1. `dist/` directory exists and contains `index.html`
2. Check browser console for JavaScript errors
3. Ensure Flask/Uvicorn is serving static files correctly

## Frontend Structure

After build, the `dist/` directory contains:

```
dist/
├── index.html           # Main entry point
├── assets/
│   ├── index-*.js      # Main JavaScript bundle
│   ├── index-*.css     # CSS bundle
│   └── ...other assets
└── ...other files
```

The entire `dist/` directory is served statically, with `index.html` as fallback for SPA routing.

## Performance Notes

- The build is optimized for production
- Assets are hashed for cache busting
- CSS and JS are minified
- Large dependencies are properly chunked
- Source maps are excluded from production build

## Next Steps

After building:
1. Test the admin panel in your browser
2. Verify all API endpoints work correctly
3. Check browser console for any errors
4. Validate frontend features with the running backend
