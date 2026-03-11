const PAGE_LIMIT = 1000

export async function fetchAllPages<T>(
  fetchPage: (
    skip: number,
    limit: number,
  ) => Promise<{ results: T[]; paging: { total: number } }>,
): Promise<T[]> {
  const first = await fetchPage(0, PAGE_LIMIT)
  const { total } = first.paging

  if (total <= PAGE_LIMIT) return first.results

  const remaining = Math.ceil((total - PAGE_LIMIT) / PAGE_LIMIT)
  const pages = await Promise.all(
    Array.from({ length: remaining }, (_, i) =>
      fetchPage((i + 1) * PAGE_LIMIT, PAGE_LIMIT),
    ),
  )

  return [first, ...pages].flatMap((p) => p.results)
}

type CsvColumn = { key: string; label: string; type?: "date" }

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function formatValue(value: unknown, type?: CsvColumn["type"]): string {
  if (value == null) return ""
  if (type === "date") return formatDate(String(value))
  return String(value)
}

export function exportToCsv<T extends Record<string, unknown>>(
  filename: string,
  data: T[],
  columnMap: CsvColumn[],
) {
  if (data.length === 0) return

  const header = columnMap.map((c) => c.label).join(",")

  const rows = data.map((row) =>
    columnMap
      .map((col) => {
        const keys = col.key.split(".")
        let value: unknown = row
        for (const k of keys) {
          value = (value as Record<string, unknown>)?.[k]
        }
        const str = formatValue(value, col.type)
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str
      })
      .join(","),
  )

  const csv = [header, ...rows].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
