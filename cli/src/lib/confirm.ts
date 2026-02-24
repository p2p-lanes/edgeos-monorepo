import { apiGet } from "./api.ts";
import { formatValue } from "./output.ts";

export interface FieldChange {
  field: string;
  from: any;
  to: any;
}

export interface ConfirmOptions {
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

export function getConfirmOptions(cmd: any): ConfirmOptions {
  const opts = cmd.optsWithGlobals();
  return {
    json: opts.json,
    yes: opts.yes,
    dryRun: opts.dryRun,
  };
}

export function computeChanges(
  current: Record<string, any>,
  proposed: Record<string, any>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, newValue] of Object.entries(proposed)) {
    const currentValue = current[field];
    if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
      changes.push({ field, from: currentValue, to: newValue });
    }
  }
  return changes;
}

export function promptYesNo(message: string): Promise<boolean> {
  process.stdout.write(message);
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk: string | Buffer) => {
      process.stdin.pause();
      const answer = chunk.toString().trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}

function displayDiffTable(changes: FieldChange[]): void {
  const fieldWidth = Math.max(5, ...changes.map((c) => c.field.length));
  const fromWidth = Math.max(
    7,
    ...changes.map((c) => formatValue(c.from).length)
  );
  const toWidth = Math.max(3, ...changes.map((c) => formatValue(c.to).length));

  process.stdout.write(
    `${"FIELD".padEnd(fieldWidth)}  ${"CURRENT".padEnd(fromWidth)}  ${"NEW".padEnd(toWidth)}\n`
  );
  process.stdout.write(
    `${"-".repeat(fieldWidth)}  ${"-".repeat(fromWidth)}  ${"-".repeat(toWidth)}\n`
  );

  for (const change of changes) {
    process.stdout.write(
      `${change.field.padEnd(fieldWidth)}  ${formatValue(change.from).padEnd(fromWidth)}  ${formatValue(change.to).padEnd(toWidth)}\n`
    );
  }
}

function displayKeyValues(data: Record<string, any>): void {
  const keys = Object.keys(data);
  const maxKeyLen = Math.max(...keys.map((k) => k.length));
  for (const [key, value] of Object.entries(data)) {
    process.stdout.write(
      `  ${key.padEnd(maxKeyLen)}  ${formatValue(value)}\n`
    );
  }
}

export async function confirmUpdate(
  resourcePath: string,
  label: string,
  body: Record<string, any>,
  opts: ConfirmOptions
): Promise<{ confirmed: boolean }> {
  if (opts.yes && !opts.dryRun) {
    return { confirmed: true };
  }

  const current = await apiGet(resourcePath);
  const changes = computeChanges(current, body);

  if (changes.length === 0) {
    process.stdout.write("No changes detected.\n");
    return { confirmed: false };
  }

  const id =
    resourcePath.split("/").pop() || label;
  process.stdout.write(`\n--- Proposed changes to ${label} ${id} ---\n\n`);

  if (opts.json) {
    process.stdout.write(JSON.stringify(changes, null, 2) + "\n");
  } else {
    displayDiffTable(changes);
  }

  process.stdout.write("\n");

  if (opts.dryRun) {
    return { confirmed: false };
  }

  const confirmed = await promptYesNo("Proceed? [y/N]: ");
  return { confirmed };
}

export async function confirmDelete(
  resourcePath: string,
  label: string,
  opts: ConfirmOptions
): Promise<{ confirmed: boolean }> {
  if (opts.yes && !opts.dryRun) {
    return { confirmed: true };
  }

  const current = await apiGet(resourcePath);

  const id =
    resourcePath.split("/").pop() || label;
  process.stdout.write(`\n--- Will delete ${label} ${id} ---\n\n`);

  if (opts.json) {
    process.stdout.write(JSON.stringify(current, null, 2) + "\n");
  } else {
    displayKeyValues(current);
  }

  process.stdout.write("\n");

  if (opts.dryRun) {
    return { confirmed: false };
  }

  const confirmed = await promptYesNo(`Delete this ${label}? [y/N]: `);
  return { confirmed };
}

export async function confirmCreate(
  label: string,
  body: Record<string, any>,
  opts: ConfirmOptions
): Promise<{ confirmed: boolean }> {
  if (opts.yes && !opts.dryRun) {
    return { confirmed: true };
  }

  process.stdout.write(`\n--- Will create ${label} ---\n\n`);

  if (opts.json) {
    process.stdout.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    displayKeyValues(body);
  }

  process.stdout.write("\n");

  if (opts.dryRun) {
    return { confirmed: false };
  }

  const confirmed = await promptYesNo(`Create this ${label}? [y/N]: `);
  return { confirmed };
}
