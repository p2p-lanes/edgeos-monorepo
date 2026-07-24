import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { MailX } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import {
  type EmailLogPublic,
  EmailLogsService,
  EmailTemplatesService,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

const ALL = "all"

const STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
]

export const Route = createFileRoute("/_layout/email-logs")({
  component: EmailLogs,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Email Logs - EdgeOS" }],
  }),
})

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

function buildColumns(
  typeLabels: Map<string, string>,
): ColumnDef<EmailLogPublic>[] {
  return [
    {
      accessorKey: "created_at",
      header: "When",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dateFormatter.format(new Date(row.original.created_at))}
        </span>
      ),
    },
    {
      accessorKey: "to_email",
      header: "Recipient",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.to_email}</span>
      ),
    },
    {
      accessorKey: "subject",
      header: "Subject",
      enableSorting: false,
      cell: ({ row }) => {
        const subject = row.original.subject
        const error = row.original.error
        return (
          <div className="max-w-[28rem]">
            <span
              className="block truncate text-muted-foreground"
              title={subject ?? undefined}
            >
              {subject ?? "—"}
            </span>
            {row.original.status === "failed" && error && (
              <span
                className="block truncate text-xs text-destructive"
                title={error}
              >
                {error}
              </span>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "template_type",
      header: "Template",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {typeLabels.get(row.original.template_type) ??
            row.original.template_type}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === "failed" ? (
          <Badge variant="destructive">Failed</Badge>
        ) : (
          <Badge variant="secondary">Sent</Badge>
        ),
    },
  ]
}

function EmailLogsContent() {
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/email-logs",
  )

  const [templateType, setTemplateType] = useState<string>(ALL)
  const [status, setStatus] = useState<string>(ALL)

  const resetPage = () =>
    setPagination({ pageIndex: 0, pageSize: pagination.pageSize })

  const { data: types } = useQuery({
    queryKey: ["email-template-types"],
    queryFn: () => EmailTemplatesService.listTemplateTypes(),
  })

  const typeLabels = useMemo(
    () => new Map((types ?? []).map((t) => [t.type, t.label])),
    [types],
  )

  const columns = useMemo(() => buildColumns(typeLabels), [typeLabels])

  const { data } = useQuery({
    queryKey: [
      "email-logs",
      {
        popupId: selectedPopupId,
        templateType,
        status,
        search,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
      },
    ],
    queryFn: () =>
      EmailLogsService.listEmailLogs({
        popupId: selectedPopupId || undefined,
        templateType: templateType === ALL ? undefined : templateType,
        status: status === ALL ? undefined : status,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
      }),
    placeholderData: keepPreviousData,
  })

  if (!data) return <Skeleton className="h-64 w-full" />

  const hasFilters = !!search || templateType !== ALL || status !== ALL

  return (
    <DataTable
      columns={columns}
      data={data.results}
      searchPlaceholder="Search by recipient or subject..."
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: data.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={templateType}
            onValueChange={(v) => {
              setTemplateType(v)
              resetPage()
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {(types ?? []).map((t) => (
                <SelectItem key={t.type} value={t.type}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v)
              resetPage()
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      emptyState={
        <EmptyState
          icon={MailX}
          title={
            hasFilters ? "No emails match your filters" : "No emails sent yet"
          }
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : "Emails sent to applicants and attendees will appear here."
          }
        />
      }
    />
  )
}

function EmailLogs() {
  const { isContextReady } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()

  if (!isOperatorOrAbove) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Email Logs</h1>
        <p className="text-muted-foreground">
          You need admin permissions to view email logs.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email Logs</h1>
        <p className="text-muted-foreground">
          Every email sent to applicants and attendees
        </p>
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="email logs" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EmailLogsContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
