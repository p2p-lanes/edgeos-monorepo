/**
 * Extract the items array from an API response.
 * Handles both direct arrays and paginated { results: [...], paging: {...} } responses.
 */
export function extractResults(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export function formatTable(
  rows: Record<string, any>[],
  columns?: string[]
): string {
  if (rows.length === 0) {
    return "No results found.";
  }

  // Determine columns
  const cols = columns || Object.keys(rows[0]);

  // Calculate column widths (min 4 chars to fit headers)
  const maxValueLen = 40;
  const colWidths: Record<string, number> = {};

  for (const col of cols) {
    const headerLen = col.toUpperCase().length;
    let maxLen = headerLen;
    for (const row of rows) {
      const val = formatValue(row[col]);
      const truncated = val.length > maxValueLen ? val.slice(0, maxValueLen - 3) + "..." : val;
      maxLen = Math.max(maxLen, truncated.length);
    }
    colWidths[col] = maxLen;
  }

  // Build header
  const header = cols
    .map((col) => col.toUpperCase().padEnd(colWidths[col]))
    .join("  ");

  // Build separator
  const separator = cols
    .map((col) => "-".repeat(colWidths[col]))
    .join("  ");

  // Build rows
  const dataRows = rows.map((row) =>
    cols
      .map((col) => {
        const val = formatValue(row[col]);
        const truncated =
          val.length > maxValueLen ? val.slice(0, maxValueLen - 3) + "..." : val;
        return truncated.padEnd(colWidths[col]);
      })
      .join("  ")
  );

  return [header, separator, ...dataRows].join("\n");
}

export function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function outputResult(
  data: any,
  options: { json?: boolean }
): void {
  if (options.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  // If data is an array, format as table
  if (Array.isArray(data)) {
    process.stdout.write(formatTable(data) + "\n");
    return;
  }

  // If data is an object, format as key-value pairs
  if (typeof data === "object" && data !== null) {
    const maxKeyLen = Math.max(
      ...Object.keys(data).map((k) => k.length)
    );
    for (const [key, value] of Object.entries(data)) {
      const formattedKey = key.padEnd(maxKeyLen);
      process.stdout.write(`${formattedKey}  ${formatValue(value)}\n`);
    }
    return;
  }

  process.stdout.write(String(data) + "\n");
}

export function outputError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

export function outputSuccess(message: string): void {
  process.stdout.write(`${message}\n`);
}
