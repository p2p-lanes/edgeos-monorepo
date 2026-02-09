export function exportToCsv<T extends Record<string, unknown>>(
  filename: string,
  data: T[],
  columnMap: { key: string; label: string }[],
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
        const str = value == null ? "" : String(value)
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
