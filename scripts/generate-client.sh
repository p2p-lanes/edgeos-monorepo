#! /usr/bin/env bash

set -e
set -x

strip_generated_trailing_whitespace() {
  uv run --project backend python - "$@" <<'PY'
from pathlib import Path
import sys

for filename in sys.argv[1:]:
    path = Path(filename)
    text = path.read_text()
    path.write_text("\n".join(line.rstrip() for line in text.split("\n")))
PY
}

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

strip_generated_trailing_whitespace \
  backoffice/src/client/sdk.gen.ts \
  portal/src/client/sdk.gen.ts

rm -f openapi.json
