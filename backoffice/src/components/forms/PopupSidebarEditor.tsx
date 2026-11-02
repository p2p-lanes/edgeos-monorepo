import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface SidebarLink {
  id: string
  label: string
  url: string
}

export type SidebarResourceKey =
  | "home"
  | "application"
  | "passes"
  | "orders"
  | "checkouts"
  | "directory"
  | "events"
  | "agentic_access"
  | "referrals"
  | "groups"

export interface SidebarSectionBlock {
  id: string
  type: "section"
  title?: string
  group?: "commerce" | "checkouts" | "community"
  items: SidebarResourceKey[]
  links: SidebarLink[]
}

export interface SidebarItemBlock {
  id: string
  type: "item"
  resource: SidebarResourceKey
}

export type SidebarLayoutBlock = SidebarSectionBlock | SidebarItemBlock

export interface PopupSidebarConfig {
  [key: string]: unknown
  layout: SidebarLayoutBlock[]
  hidden_items: string[]
}

export const SIDEBAR_RESOURCE_OPTIONS: {
  key: SidebarResourceKey
  label: string
}[] = [
  { key: "home", label: "Home" },
  { key: "application", label: "Application" },
  { key: "passes", label: "Passes" },
  { key: "orders", label: "Payments" },
  { key: "checkouts", label: "Checkout options" },
  { key: "directory", label: "Directory" },
  { key: "events", label: "Event calendar" },
  { key: "agentic_access", label: "Agentic access" },
  { key: "referrals", label: "Referrals" },
  { key: "groups", label: "Groups" },
]

const EVENT_SUBITEMS = [
  { key: "tracks", label: "Tracks" },
  { key: "venues", label: "Venues" },
] as const

const defaultBlock = (
  id: string,
  group: "commerce" | "checkouts" | "community",
  items: SidebarResourceKey[],
): SidebarSectionBlock => ({
  id,
  type: "section",
  group,
  items,
  links: [],
})

const SECTION_LABELS: Record<
  NonNullable<SidebarSectionBlock["group"]>,
  string
> = {
  commerce: "General",
  checkouts: "Commerce",
  community: "Community",
}

export const DEFAULT_POPUP_SIDEBAR_CONFIG: PopupSidebarConfig = {
  layout: [
    defaultBlock("general", "commerce", [
      "home",
      "application",
      "passes",
      "orders",
    ]),
    defaultBlock("commerce", "checkouts", ["checkouts"]),
    defaultBlock("community", "community", [
      "directory",
      "events",
      "agentic_access",
      "referrals",
      "groups",
    ]),
  ],
  hidden_items: [],
}

export function PopupSidebarEditor({
  value,
  onChange,
  disabled,
}: {
  value: PopupSidebarConfig | null
  onChange: (value: PopupSidebarConfig) => void
  disabled: boolean
}) {
  const [linkDrafts, setLinkDrafts] = useState<Record<string, SidebarLink>>({})
  const layout = value?.layout ?? DEFAULT_POPUP_SIDEBAR_CONFIG.layout
  const hiddenItems = value?.hidden_items ?? []
  const assignedResources = new Set(
    layout.flatMap((block) =>
      block.type === "section" ? block.items : [block.resource],
    ),
  )

  const updateConfig = (next: Partial<PopupSidebarConfig>) =>
    onChange({
      ...(value ?? DEFAULT_POPUP_SIDEBAR_CONFIG),
      layout,
      hidden_items: hiddenItems,
      ...next,
    })

  const updateLayout = (next: SidebarLayoutBlock[]) =>
    updateConfig({ layout: next })

  const updateSection = (index: number, update: Partial<SidebarSectionBlock>) =>
    updateLayout(
      layout.map((block, current) =>
        current === index && block.type === "section"
          ? { ...block, ...update }
          : block,
      ),
    )

  const moveBlock = (index: number, offset: number) => {
    const next = [...layout]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    updateLayout(next)
  }

  const renderEventSubitems = () => (
    <div className="ml-4 space-y-1 border-l pl-3">
      {EVENT_SUBITEMS.map((subitem) => (
        <label
          key={subitem.key}
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <input
            type="checkbox"
            checked={!hiddenItems.includes(subitem.key)}
            disabled={disabled}
            onChange={(event) =>
              updateConfig({
                hidden_items: event.target.checked
                  ? hiddenItems.filter((hidden) => hidden !== subitem.key)
                  : [...hiddenItems, subitem.key],
              })
            }
          />
          {subitem.label}
        </label>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add menu options to sections or leave them at the top level. Drag the
        sections and options into the order you want.
      </p>
      <ol className="space-y-3">
        {layout.map((block, index) => (
          <li key={block.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              {block.type === "section" ? (
                <Input
                  aria-label="Section title"
                  placeholder="Section title"
                  value={
                    block.title ??
                    (block.group ? SECTION_LABELS[block.group] : "")
                  }
                  disabled={disabled}
                  onChange={(event) =>
                    updateSection(index, { title: event.target.value })
                  }
                />
              ) : (
                <span className="flex-1 text-sm font-medium">
                  {SIDEBAR_RESOURCE_OPTIONS.find(
                    (option) => option.key === block.resource,
                  )?.label ?? block.resource}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move ${block.type === "section" ? block.title : block.resource} up`}
                disabled={disabled || index === 0}
                onClick={() => moveBlock(index, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move ${block.type === "section" ? block.title : block.resource} down`}
                disabled={disabled || index === layout.length - 1}
                onClick={() => moveBlock(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              {block.type === "item" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Return ${block.resource} to a section`}
                  disabled={disabled}
                  onClick={() =>
                    updateLayout(
                      layout.filter((_, current) => current !== index),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              {block.type === "section" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${block.title ?? "untitled"} section`}
                  disabled={disabled}
                  onClick={() =>
                    updateLayout(
                      layout.filter((_, current) => current !== index),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {block.type === "item" && block.resource === "events" && (
              <div className="pt-2">{renderEventSubitems()}</div>
            )}

            {block.type === "section" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {block.items.map((item, itemIndex) => {
                    const option = SIDEBAR_RESOURCE_OPTIONS.find(
                      (candidate) => candidate.key === item,
                    )
                    return (
                      <div key={item} className="space-y-1 border-b pb-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="flex-1">
                            {option?.label ?? item}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Move ${option?.label ?? item} up`}
                            disabled={disabled || itemIndex === 0}
                            onClick={() => {
                              const items = [...block.items]
                              ;[items[itemIndex - 1], items[itemIndex]] = [
                                items[itemIndex],
                                items[itemIndex - 1],
                              ]
                              updateSection(index, { items })
                            }}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Move ${option?.label ?? item} down`}
                            disabled={
                              disabled || itemIndex === block.items.length - 1
                            }
                            onClick={() => {
                              const items = [...block.items]
                              ;[items[itemIndex], items[itemIndex + 1]] = [
                                items[itemIndex + 1],
                                items[itemIndex],
                              ]
                              updateSection(index, { items })
                            }}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${option?.label ?? item} from section`}
                            disabled={disabled}
                            onClick={() =>
                              updateSection(index, {
                                items: block.items.filter(
                                  (current) => current !== item,
                                ),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {item === "events" && renderEventSubitems()}
                      </div>
                    )
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  {SIDEBAR_RESOURCE_OPTIONS.filter(
                    (option) => !assignedResources.has(option.key),
                  ).map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        updateSection(index, {
                          items: [...block.items, option.key],
                        })
                      }
                    >
                      <Plus className="mr-1 h-3 w-3" /> {option.label}
                    </Button>
                  ))}
                </div>

                {block.links.map((link) => (
                  <div key={link.id} className="flex flex-wrap gap-2">
                    <Input
                      aria-label="Link name"
                      placeholder="Link name"
                      value={link.label}
                      disabled={disabled}
                      onChange={(event) =>
                        updateSection(index, {
                          links: block.links.map((item) =>
                            item.id === link.id
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <Input
                      aria-label="Link URL"
                      placeholder="URL"
                      value={link.url}
                      disabled={disabled}
                      onChange={(event) =>
                        updateSection(index, {
                          links: block.links.map((item) =>
                            item.id === link.id
                              ? { ...item, url: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Delete external link"
                      disabled={disabled}
                      onClick={() =>
                        updateSection(index, {
                          links: block.links.filter(
                            (item) => item.id !== link.id,
                          ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Link name"
                    aria-label="New link name"
                    value={linkDrafts[block.id]?.label ?? ""}
                    disabled={disabled}
                    onChange={(event) =>
                      setLinkDrafts((drafts) => ({
                        ...drafts,
                        [block.id]: {
                          id: drafts[block.id]?.id ?? crypto.randomUUID(),
                          label: event.target.value,
                          url: drafts[block.id]?.url ?? "",
                        },
                      }))
                    }
                  />
                  <Input
                    placeholder="URL"
                    aria-label="New link URL"
                    value={linkDrafts[block.id]?.url ?? ""}
                    disabled={disabled}
                    onChange={(event) =>
                      setLinkDrafts((drafts) => ({
                        ...drafts,
                        [block.id]: {
                          id: drafts[block.id]?.id ?? crypto.randomUUID(),
                          label: drafts[block.id]?.label ?? "",
                          url: event.target.value,
                        },
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      disabled ||
                      !linkDrafts[block.id]?.label ||
                      !linkDrafts[block.id]?.url
                    }
                    onClick={() => {
                      const link = linkDrafts[block.id]
                      if (!link) return
                      updateSection(index, { links: [...block.links, link] })
                      setLinkDrafts((drafts) => ({
                        ...drafts,
                        [block.id]: {
                          id: crypto.randomUUID(),
                          label: "",
                          url: "",
                        },
                      }))
                    }}
                  >
                    Add link
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            updateLayout([
              ...layout,
              {
                id: `custom-${crypto.randomUUID()}`,
                type: "section",
                title: "New section",
                items: [],
                links: [],
              },
            ])
          }
        >
          <Plus className="mr-2 h-4 w-4" /> Add section
        </Button>
        {SIDEBAR_RESOURCE_OPTIONS.filter(
          (option) => !assignedResources.has(option.key),
        ).map((option) => (
          <Button
            key={option.key}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              updateLayout([
                ...layout,
                {
                  id: `item-${option.key}`,
                  type: "item",
                  resource: option.key,
                },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Add {option.label} at top level
          </Button>
        ))}
        {value && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(DEFAULT_POPUP_SIDEBAR_CONFIG)}
          >
            Use default navigation
          </Button>
        )}
      </div>
    </div>
  )
}
