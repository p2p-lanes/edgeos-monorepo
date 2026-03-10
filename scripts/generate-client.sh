#! /usr/bin/env bash

set -e
set -x

# Extract OpenAPI spec from backend
cd backend
uv run python -c "import app.main; import json; print(json.dumps(app.main.application.openapi()))" > ../openapi.json
cd ..

# Generate for backoffice (Axios client)
cp openapi.json backoffice/
cd backoffice
pnpm run generate-client
pnpm run lint
cd ..

# Generate for portal (Fetch client)
cp openapi.json portal/
cd portal
pnpm run generate-client
pnpm run lint
cd ..

rm -f openapi.json
