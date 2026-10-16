import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useEffect } from "react"
import {
  AttendeeCategoriesService,
  FormFieldsService,
  SalesFlowsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type DirectoryFieldConfig = {
  id: string
  label: string
  source: "human" | "application" | "attendee"
  key: string
  shareable: boolean
}

type DirectoryFieldChoice = DirectoryFieldConfig & {
  sourceLabel: string
}

type Props = {
  popupId?: string
  fields: DirectoryFieldConfig[]
  onChange: (fields: DirectoryFieldConfig[]) => void
  disabled?: boolean
}

const HUMAN_FIELDS: DirectoryFieldChoice[] = [
  {
    id: "first_name",
    label: "First name",
    source: "human",
    key: "first_name",
    shareable: true,
    sourceLabel: "Human profile",
  },
  {
    id: "last_name",
    label: "Last name",
    source: "human",
    key: "last_name",
    shareable: true,
    sourceLabel: "Human profile",
  },
  {
    id: "email",
    label: "Email",
    source: "human",
    key: "email",
    shareable: true,
    sourceLabel: "Human profile",
  },
  {
    id: "telegram",
    label: "Telegram username",
    source: "human",
    key: "telegram",
    shareable: true,
    sourceLabel: "Human profile",
  },
  {
    id: "residence",
    label: "Residence",
    source: "human",
    key: "residence",
    shareable: true,
    sourceLabel: "Human profile",
  },
  {
    id: "age",
    label: "Age",
    source: "human",
    key: "age",
    shareable: true,
    sourceLabel: "Human profile",
  },
  {
    id: "gender",
    label: "Gender",
    source: "human",
    key: "gender",
    shareable: true,
    sourceLabel: "Human profile",
  },
]

const DEFAULT_DIRECTORY_FIELDS: DirectoryFieldConfig[] = [
  ...HUMAN_FIELDS.slice(0, 4),
].map(({ sourceLabel: _sourceLabel, ...field }) => field)

const APPLICATION_KEY_ALIASES: Record<string, string> = {
  role_in_the_organization: "role",
  organization_you_represent: "organization",
}

const fieldIdentity = (field: Pick<DirectoryFieldConfig, "source" | "key">) => {
  const key =
    field.source === "application"
      ? (APPLICATION_KEY_ALIASES[field.key] ?? field.key)
      : field.key
  return `${field.source}:${key}`
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")

export function DirectoryFieldsEditor({
  popupId,
  fields,
  onChange,
  disabled,
}: Props) {
  const flowsQuery = useQuery({
    queryKey: ["sales-flows", popupId, "directory-fields"],
    queryFn: () =>
      SalesFlowsService.listSalesFlows({ popupId: popupId!, limit: 100 }),
    enabled: !!popupId,
  })
  const primaryApplicationFlow = flowsQuery.data?.results.find(
    (flow) => flow.type === "application" && flow.is_default,
  )
  const applicationFieldsQuery = useQuery({
    queryKey: ["form-fields", popupId, primaryApplicationFlow?.id, "directory"],
    queryFn: () =>
      FormFieldsService.listFormFields({
        popupId: popupId!,
        salesFlowId: primaryApplicationFlow!.id,
        limit: 200,
      }),
    enabled: !!popupId && !!primaryApplicationFlow?.id,
  })
  const categoriesQuery = useQuery({
    queryKey: ["attendee-categories", popupId, "directory-fields"],
    queryFn: () =>
      AttendeeCategoriesService.listAttendeeCategories({ popupId: popupId! }),
    enabled: !!popupId,
  })

  const applicationChoices: DirectoryFieldChoice[] = (
    applicationFieldsQuery.data?.results ?? []
  )
    .filter(
      (field) =>
        !field.protected &&
        field.name &&
        field.name.toLowerCase() !== "email" &&
        field.target !== "human",
    )
    .map((field) => ({
      id: `application_${field.id.replace(/-/g, "_")}`,
      label: field.short_label || field.label || field.name,
      source: "application",
      key: field.name,
      shareable: true,
      sourceLabel: "Application",
    }))

  const attendeeFields = (categoriesQuery.data?.results ?? [])
    .filter((category) => category.directory_eligible)
    .flatMap((category) =>
      (category.required_fields ?? []).map((rawField) => {
        const field = rawField as { name?: unknown; label?: unknown }
        return {
          name: typeof field.name === "string" ? field.name : "",
          label: typeof field.label === "string" ? field.label : "",
        }
      }),
    )
  const attendeeChoices: DirectoryFieldChoice[] = Array.from(
    new Map(
      attendeeFields
        .filter(
          (field) =>
            field.name &&
            slug(field.name) &&
            field.name.toLowerCase() !== "email",
        )
        .map((field) => [
          field.name,
          {
            id: `attendee_${slug(field.name)}`,
            label: field.label || field.name,
            source: "attendee" as const,
            key: field.name,
            shareable: true,
            sourceLabel: "Attendee details",
          },
        ]),
    ).values(),
  )

  const choices = [...HUMAN_FIELDS, ...applicationChoices, ...attendeeChoices]
  const savedFields = fields.length > 0 ? fields : DEFAULT_DIRECTORY_FIELDS
  const choicesByIdentity = new Map(
    choices.map((choice) => [fieldIdentity(choice), choice]),
  )
  const selectedFields = savedFields.flatMap((field) => {
    const choice = choicesByIdentity.get(fieldIdentity(field))
    return choice
      ? [{ ...field, key: choice.key, sourceLabel: choice.sourceLabel }]
      : []
  })
  const selectedIdentities = new Set(selectedFields.map(fieldIdentity))
  const selectedChoices: DirectoryFieldChoice[] = selectedFields.map(
    ({ sourceLabel, ...field }) => ({ ...field, sourceLabel }),
  )
  const allChoices = [
    ...selectedChoices,
    ...choices.filter(
      (choice) => !selectedIdentities.has(fieldIdentity(choice)),
    ),
  ]
  const isLoading =
    !!popupId &&
    (flowsQuery.isLoading ||
      applicationFieldsQuery.isLoading ||
      categoriesQuery.isLoading)
  const choicesLoaded =
    !!popupId &&
    flowsQuery.isSuccess &&
    categoriesQuery.isSuccess &&
    (!primaryApplicationFlow || applicationFieldsQuery.isSuccess)

  useEffect(() => {
    if (!choicesLoaded || fields.length === 0) return
    const normalized = selectedFields.map(
      ({ sourceLabel: _sourceLabel, ...field }) => field,
    )
    const nextFields =
      normalized.length > 0 ? normalized : DEFAULT_DIRECTORY_FIELDS
    if (JSON.stringify(nextFields) !== JSON.stringify(fields)) {
      onChange(nextFields)
    }
  }, [choicesLoaded, fields, onChange, selectedFields])

  const toggleField = (choice: DirectoryFieldChoice, selected: boolean) => {
    if (selected) {
      if (selectedIdentities.has(fieldIdentity(choice))) return
      onChange([
        ...selectedFields.map(
          ({ sourceLabel: _sourceLabel, ...field }) => field,
        ),
        {
          id: choice.id,
          label: choice.label,
          source: choice.source,
          key: choice.key,
          shareable: true,
        },
      ])
      return
    }
    const remaining = selectedFields.filter(
      (field) => fieldIdentity(field) !== fieldIdentity(choice),
    )
    if (remaining.length === 0) return
    onChange(remaining.map(({ sourceLabel: _sourceLabel, ...field }) => field))
  }

  const updateSharing = (choice: DirectoryFieldChoice, shareable: boolean) => {
    onChange(
      selectedFields.map(({ sourceLabel: _sourceLabel, ...field }) =>
        fieldIdentity(field) === fieldIdentity(choice)
          ? { ...field, shareable }
          : field,
      ),
    )
  }

  const moveField = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= selectedFields.length) return
    const reordered = [...selectedFields]
    ;[reordered[index], reordered[nextIndex]] = [
      reordered[nextIndex],
      reordered[index],
    ]
    onChange(reordered.map(({ sourceLabel: _sourceLabel, ...field }) => field))
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Directory fields</p>
        <p className="text-xs text-muted-foreground">
          Select fields that exist in this popup. Attendees choose which
          selected fields to share, and new fields start hidden.
        </p>
        <p className="text-xs text-muted-foreground">
          Saved selections are matched to the current form fields. Fields that
          no longer exist are removed when you save the popup.
        </p>
        {!popupId && (
          <p className="mt-1 text-xs text-muted-foreground">
            Save the popup first to choose application and attendee fields.
          </p>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading available fields…
        </p>
      ) : (
        <div className="max-h-[360px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">Show</TableHead>
                <TableHead>Field</TableHead>
                <TableHead className="w-28">Sharing</TableHead>
                <TableHead className="w-20 text-right">Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allChoices.map((choice) => {
                const identity = fieldIdentity(choice)
                const selected = selectedIdentities.has(identity)
                const order = selectedFields.findIndex(
                  (field) => fieldIdentity(field) === identity,
                )
                const selectedField = order >= 0 ? selectedFields[order] : null
                return (
                  <TableRow key={identity}>
                    <TableCell>
                      <Checkbox
                        id={`directory-field-${slug(identity)}`}
                        aria-label={`Include ${choice.label}`}
                        checked={selected}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          toggleField(choice, checked === true)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <label
                        htmlFor={`directory-field-${slug(identity)}`}
                        className="cursor-pointer text-sm font-medium"
                      >
                        {choice.label}
                      </label>
                    </TableCell>
                    <TableCell>
                      {selectedField ? (
                        <Checkbox
                          id={`directory-share-${slug(identity)}`}
                          aria-label={`Allow attendees to share ${choice.label}`}
                          checked={selectedField.shareable}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            updateSharing(choice, checked === true)
                          }
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {selectedField ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Move ${choice.label} up`}
                            disabled={disabled || order === 0}
                            onClick={() => moveField(order, -1)}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Move ${choice.label} down`}
                            disabled={
                              disabled || order === selectedFields.length - 1
                            }
                            onClick={() => moveField(order, 1)}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {allChoices.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-16 text-center text-sm text-muted-foreground"
                  >
                    No directory fields are available yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
