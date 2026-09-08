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

# The generator emits whitespace-only SDK lines that the excluded client
# directories do not pass through Biome. Keep regeneration free of that churn.
uv run python -c '
from pathlib import Path
for app in ("backoffice", "portal"):
    path = Path(app) / "src/client/sdk.gen.ts"
    path.write_text("".join(line if line.strip() else "\n" for line in path.read_text().splitlines(keepends=True)))
'

rm -f openapi.json
