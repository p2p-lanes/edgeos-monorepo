import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Pencil, RotateCcw, Trash2, Upload, UserPlus } from "lucide-react"
import Papa from "papaparse"
import { useMemo, useRef, useState } from "react"

import {
  type ApiError,
  ApplicationsService,
  type ProductPublic,
  ProductsService,
} from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/popups/$id/bulk-grant")({
  component: BulkGrantPage,
  head: () => ({
    meta: [{ title: "Grant Tickets - EdgeOS" }],
  }),
})

interface PersonRow {
  id: string
  email: string
  first_name: string
  last_name: string
  errors: { email?: string; first_name?: string; last_name?: string }
  productsOverride: Record<string, number> | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validatePerson(
  p: Pick<PersonRow, "email" | "first_name" | "last_name">,
): PersonRow["errors"] {
  const errors: PersonRow["errors"] = {}
  if (!p.email.trim()) errors.email = "Email is required"
  else if (!EMAIL_RE.test(p.email.trim())) errors.email = "Invalid email"
  return errors
}

function downloadPeopleTemplate() {
  const blob = new Blob(["first_name,last_name,email\n"], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "people-grant-template.csv"
  a.click()
  URL.revokeObjectURL(url)
}

function effectiveProducts(
  person: PersonRow,
  defaultProducts: Record<string, number>,
): Record<string, number> {
  return person.productsOverride ?? defaultProducts
}

function sumQuantities(qty: Record<string, number>): number {
  let total = 0
  for (const v of Object.values(qty)) total += v
  return total
}

function BulkGrantPage() {
  const { id: popupId } = Route.useParams()
  const { isOperatorOrAbove, isUserLoading } = useAuth()

  if (isUserLoading) {
    return (
      <FormPageLayout
        title="Grant Tickets"
        description="Assign free tickets to multiple people at once."
        backTo="/attendees"
      >
        <div className="text-sm text-muted-foreground">Loading…</div>
      </FormPageLayout>
    )
  }
  if (!isOperatorOrAbove) {
    return (
      <FormPageLayout
        title="Access denied"
        description="You do not have permission to grant tickets."
        backTo="/attendees"
      >
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
          This action is restricted to operators, admins and superadmins.
        </div>
      </FormPageLayout>
    )
  }

  return (
    <FormPageLayout
      title="Grant Tickets"
      description="Assign one or more free tickets to a batch of people."
      backTo="/attendees"
    >
      <QueryErrorBoundary>
        <BulkGrantContent popupId={popupId} />
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}

function BulkGrantContent({ popupId }: { popupId: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [people, setPeople] = useState<PersonRow[]>([])
  const [defaultProducts, setDefaultProducts] = useState<
    Record<string, number>
  >({})
  const [stockErrorPid, setStockErrorPid] = useState<string | null>(null)
  const [personFormState, setPersonFormState] = useState<
    { mode: "add" } | { mode: "edit"; index: number } | null
  >(null)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)
  const [editProductsIndex, setEditProductsIndex] = useState<number | null>(
    null,
  )
  const [resetAllOpen, setResetAllOpen] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const addPerson = (
    person: Pick<PersonRow, "email" | "first_name" | "last_name">,
  ): boolean => {
    const email = person.email.trim().toLowerCase()
    if (people.some((p) => p.email === email)) {
      showErrorToast(`"${email}" is already in the list`)
      return false
    }
    const draft = {
      email,
      first_name: person.first_name.trim(),
      last_name: person.last_name.trim(),
    }
    setPeople((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ...draft,
        errors: validatePerson(draft),
        productsOverride: null,
      },
    ])
    return true
  }

  const editPerson = (
    idx: number,
    person: Pick<PersonRow, "email" | "first_name" | "last_name">,
  ): boolean => {
    const email = person.email.trim().toLowerCase()
    if (people.some((p, i) => i !== idx && p.email === email)) {
      showErrorToast(`"${email}" is already in the list`)
      return false
    }
    const draft = {
      email,
      first_name: person.first_name.trim(),
      last_name: person.last_name.trim(),
    }
    setPeople((prev) =>
      prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              ...draft,
              errors: validatePerson(draft),
            }
          : p,
      ),
    )
    return true
  }

  const removePerson = (idx: number) => {
    setPeople((prev) => prev.filter((_, i) => i !== idx))
  }

  const setPersonOverride = (
    idx: number,
    override: Record<string, number> | null,
  ) => {
    setStockErrorPid(null)
    setPeople((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, productsOverride: override } : p,
      ),
    )
  }

  const resetAllOverrides = () => {
    setStockErrorPid(null)
    setPeople((prev) => prev.map((p) => ({ ...p, productsOverride: null })))
  }

  const { data: productsResp, isLoading: isProductsLoading } = useQuery({
    queryKey: ["products", popupId],
    queryFn: () =>
      ProductsService.listProducts({
        popupId,
        limit: 200,
      }),
  })
  const products = productsResp?.results ?? []

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const seenEmails = new Set<string>()
        const rows: PersonRow[] = []
        for (const raw of result.data) {
          const email = (raw.email ?? "").trim().toLowerCase()
          if (!email) continue
          if (seenEmails.has(email)) continue
          seenEmails.add(email)
          const draft = {
            email,
            first_name: (raw.first_name ?? "").trim(),
            last_name: (raw.last_name ?? "").trim(),
          }
          rows.push({
            id: crypto.randomUUID(),
            ...draft,
            errors: validatePerson(draft),
            productsOverride: null,
          })
        }
        setPeople(rows)
        if (fileRef.current) fileRef.current.value = ""
      },
      error: () => {
        showErrorToast("Failed to parse CSV file")
      },
    })
  }

  const toggleDefaultProduct = (productId: string, checked: boolean) => {
    setStockErrorPid(null)
    setDefaultProducts((prev) => {
      const next = { ...prev }
      if (checked) {
        next[productId] = next[productId] ?? 1
      } else {
        delete next[productId]
      }
      return next
    })
  }
  const setDefaultProductQuantity = (productId: string, qty: number) => {
    setStockErrorPid(null)
    setDefaultProducts((prev) => ({ ...prev, [productId]: qty }))
  }

  const peopleHaveErrors = people.some((p) => Object.keys(p.errors).length > 0)
  const hasPeople = people.length > 0

  const productsById = useMemo(() => {
    const map = new Map<string, ProductPublic>()
    for (const p of products) map.set(p.id, p)
    return map
  }, [products])

  // Per-product aggregate quantity across all people, summing each person's
  // effective products (override or inherited default).
  const totalNeededByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const person of people) {
      const eff = effectiveProducts(person, defaultProducts)
      for (const [pid, qty] of Object.entries(eff)) {
        map.set(pid, (map.get(pid) ?? 0) + (qty ?? 0))
      }
    }
    return map
  }, [people, defaultProducts])

  const stockBreakdown = useMemo(() => {
    return products.map((product) => {
      const needed = totalNeededByProduct.get(product.id) ?? 0
      const available = product.total_stock_remaining ?? null
      const overdrawn =
        available !== null && available !== undefined && needed > available
      // max_per_order is a per-order cap, so check it per-person.
      let overMaxPerOrder = false
      if (product.max_per_order != null) {
        for (const person of people) {
          const eff = effectiveProducts(person, defaultProducts)
          if ((eff[product.id] ?? 0) > product.max_per_order) {
            overMaxPerOrder = true
            break
          }
        }
      }
      return {
        product,
        needed,
        available,
        overdrawn,
        overMaxPerOrder,
      }
    })
  }, [products, totalNeededByProduct, people, defaultProducts])

  const overdrawnInfo = useMemo(() => {
    const map = new Map<string, OverdrawInfo>()
    for (const b of stockBreakdown) {
      if (b.overdrawn || b.overMaxPerOrder) {
        map.set(b.product.id, {
          needed: b.needed,
          available: b.available ?? null,
          overdrawn: b.overdrawn,
          overMaxPerOrder: b.overMaxPerOrder,
          maxPerOrder: b.product.max_per_order ?? null,
        })
      }
    }
    return map
  }, [stockBreakdown])

  const stockError = overdrawnInfo.size > 0

  const overrideCount = useMemo(
    () => people.filter((p) => p.productsOverride !== null).length,
    [people],
  )

  const totalTickets = useMemo(() => {
    let total = 0
    for (const person of people) {
      total += sumQuantities(effectiveProducts(person, defaultProducts))
    }
    return total
  }, [people, defaultProducts])

  const someoneHasNoTickets = useMemo(() => {
    if (!hasPeople) return true
    return people.some(
      (p) => sumQuantities(effectiveProducts(p, defaultProducts)) < 1,
    )
  }, [people, defaultProducts, hasPeople])

  const grantMutation = useMutation({
    mutationFn: () => {
      const payloadPeople = people.map((p) => {
        const eff = effectiveProducts(p, defaultProducts)
        return {
          email: p.email,
          first_name: p.first_name || null,
          last_name: p.last_name || null,
          products: Object.entries(eff)
            .filter(([, qty]) => qty >= 1)
            .map(([product_id, quantity]) => ({ product_id, quantity })),
        }
      })
      return ApplicationsService.grantTicketsAdmin({
        requestBody: {
          popup_id: popupId,
          people: payloadPeople,
        },
      })
    },
    onSuccess: (response) => {
      const granted = response.granted.length
      const tickets = response.granted.reduce(
        (sum, g) => sum + g.tickets_created,
        0,
      )
      showSuccessToast(
        `Granted ${tickets} ticket${tickets === 1 ? "" : "s"} to ${granted} ` +
          `person${granted === 1 ? "" : "s"}`,
      )
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      queryClient.invalidateQueries({ queryKey: ["attendees"] })
      queryClient.invalidateQueries({ queryKey: ["payments"] })
      queryClient.invalidateQueries({ queryKey: ["products", popupId] })
      setPeople([])
      setDefaultProducts({})
    },
    onError: (err: ApiError) => {
      const detail = (err.body as { detail?: unknown })?.detail
      if (
        detail &&
        typeof detail === "object" &&
        (detail as { error?: string }).error === "stock_exhausted"
      ) {
        const d = detail as {
          product_id?: string
          product_name?: string
          message?: string
        }
        if (d.product_id) setStockErrorPid(d.product_id)
        showErrorToast(
          d.message ?? `Not enough stock for "${d.product_name ?? "product"}"`,
        )
        return
      }
      createErrorHandler(showErrorToast)(err)
    },
  })

  const panel2Subtitle = (() => {
    if (people.length === 0) {
      return "Add people in panel 1 to grant tickets."
    }
    if (overrideCount === 0) {
      return `Applies to all ${people.length} ${
        people.length === 1 ? "person" : "people"
      }.`
    }
    const remaining = people.length - overrideCount
    return `Applies to ${remaining} ${
      remaining === 1 ? "person" : "people"
    } (${overrideCount} customized below).`
  })()

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- People panel ---- */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>1. People</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => setPersonFormState({ mode: "add" })}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Add person
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadPeopleTemplate}
              >
                Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import CSV
              </Button>
              {overrideCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResetAllOpen(true)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset all overrides
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                hidden
                onChange={onFile}
              />
            </div>
          </CardHeader>
          <CardContent>
            {!hasPeople && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Add people one by one with <strong>Add person</strong>, or
                upload a CSV with columns:{" "}
                <code className="font-mono">first_name, last_name, email</code>.
                Duplicate emails are skipped automatically.
              </div>
            )}
            {hasPeople && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-xs">#</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead className="w-24 text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.map((p, idx) => {
                      const fullName = [p.first_name, p.last_name]
                        .filter(Boolean)
                        .join(" ") || (
                        <span className="italic text-muted-foreground">
                          No name
                        </span>
                      )
                      const emailClass = p.errors.email
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                      const eff = effectiveProducts(p, defaultProducts)
                      const isCustom = p.productsOverride !== null
                      const contributesToOverdraw = Object.entries(eff).some(
                        ([pid, qty]) =>
                          (qty ?? 0) > 0 && overdrawnInfo.has(pid),
                      )
                      return (
                        <TableRow
                          key={p.id}
                          className={
                            contributesToOverdraw
                              ? "ring-1 ring-destructive/60"
                              : undefined
                          }
                        >
                          <TableCell className="text-xs text-muted-foreground align-top">
                            {idx + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex flex-col">
                                <span className="font-medium">{fullName}</span>
                                <span
                                  className={emailClass}
                                  title={p.errors.email ?? undefined}
                                >
                                  {p.email}
                                  {p.errors.email ? ` · ${p.errors.email}` : ""}
                                </span>
                              </div>
                              <PersonProductsStrip
                                effective={eff}
                                productsById={productsById}
                                isCustom={isCustom}
                                onOpen={() => setEditProductsIndex(idx)}
                                onResetToDefault={
                                  isCustom
                                    ? () => setPersonOverride(idx, null)
                                    : undefined
                                }
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  setPersonFormState({
                                    mode: "edit",
                                    index: idx,
                                  })
                                }
                                aria-label={`Edit ${p.email}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteIndex(idx)}
                                aria-label={`Delete ${p.email}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {peopleHaveErrors && (
              <div className="mt-3 text-xs text-destructive">
                Fix the highlighted email errors before submitting.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---- Products panel ---- */}
        <Card>
          <CardHeader>
            <CardTitle>2. Default tickets per person</CardTitle>
            <p className="text-sm text-muted-foreground">{panel2Subtitle}</p>
          </CardHeader>
          <CardContent>
            {isProductsLoading && (
              <div className="text-sm text-muted-foreground">
                Loading products…
              </div>
            )}
            {!isProductsLoading && products.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                This popup has no products.
              </div>
            )}
            {!isProductsLoading && products.length > 0 && (
              <ProductsTable
                products={products}
                productQty={defaultProducts}
                onToggle={toggleDefaultProduct}
                onQty={setDefaultProductQuantity}
                overdrawnInfo={overdrawnInfo}
                stockErrorPid={stockErrorPid}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- Submit bar ---- */}
      <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t bg-background py-4">
        <div className="text-sm text-muted-foreground">
          {hasPeople && !someoneHasNoTickets ? (
            <span>
              Granting <strong>{totalTickets}</strong> ticket
              {totalTickets === 1 ? "" : "s"} to{" "}
              <strong>{people.length}</strong> person
              {people.length === 1 ? "" : "s"}
              {overrideCount > 0 ? ` (${overrideCount} customized)` : ""}.
            </span>
          ) : !hasPeople ? (
            <span>Add people and pick at least one product to continue.</span>
          ) : (
            <span>
              Each person needs at least one product — set a default in panel 2
              or customize per person.
            </span>
          )}
        </div>
        <LoadingButton
          loading={grantMutation.isPending}
          disabled={
            !hasPeople ||
            peopleHaveErrors ||
            someoneHasNoTickets ||
            stockError ||
            grantMutation.isPending
          }
          onClick={() => grantMutation.mutate()}
        >
          Grant tickets
        </LoadingButton>
      </div>

      {personFormState !== null && (
        <PersonFormDialog
          key={
            personFormState.mode === "edit"
              ? `edit-${people[personFormState.index].id}`
              : "add"
          }
          open
          onOpenChange={(o) => {
            if (!o) setPersonFormState(null)
          }}
          initialValue={
            personFormState.mode === "edit"
              ? {
                  first_name: people[personFormState.index].first_name,
                  last_name: people[personFormState.index].last_name,
                  email: people[personFormState.index].email,
                }
              : undefined
          }
          onSubmit={(person) =>
            personFormState.mode === "edit"
              ? editPerson(personFormState.index, person)
              : addPerson(person)
          }
        />
      )}

      <ConfirmDeleteDialog
        open={deleteIndex !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteIndex(null)
        }}
        person={deleteIndex !== null ? people[deleteIndex] : null}
        onConfirm={() => {
          if (deleteIndex !== null) removePerson(deleteIndex)
          setDeleteIndex(null)
        }}
      />

      {editProductsIndex !== null && (
        <PersonProductsDialog
          key={`products-${people[editProductsIndex].id}`}
          open
          person={people[editProductsIndex]}
          products={products}
          defaultProducts={defaultProducts}
          onOpenChange={(o) => {
            if (!o) setEditProductsIndex(null)
          }}
          onUseDefault={() => {
            setPersonOverride(editProductsIndex, null)
            setEditProductsIndex(null)
          }}
          onSave={(override) => {
            setPersonOverride(editProductsIndex, override)
            setEditProductsIndex(null)
          }}
        />
      )}

      <ConfirmResetAllDialog
        open={resetAllOpen}
        onOpenChange={setResetAllOpen}
        overrideCount={overrideCount}
        onConfirm={() => {
          resetAllOverrides()
          setResetAllOpen(false)
        }}
      />
    </>
  )
}

function PersonProductsStrip({
  effective,
  productsById,
  isCustom,
  onOpen,
  onResetToDefault,
}: {
  effective: Record<string, number>
  productsById: Map<string, ProductPublic>
  isCustom: boolean
  onOpen: () => void
  onResetToDefault?: () => void
}) {
  const entries = Object.entries(effective).filter(([, qty]) => qty >= 1)
  const isEmpty = entries.length === 0

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onOpen}
        className={
          "group flex flex-1 min-w-0 flex-wrap items-center gap-1.5 rounded-md border " +
          "border-transparent px-1.5 py-1 text-left transition-colors " +
          "hover:border-border hover:bg-muted/40 cursor-pointer " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
        aria-label="Edit tickets for this person"
      >
        {isEmpty && (
          <span className="text-xs italic text-muted-foreground">
            No tickets — pick products in panel 2 or click here to customize.
          </span>
        )}
        {!isEmpty &&
          entries.map(([pid, qty]) => {
            const name = productsById.get(pid)?.name ?? "Unknown"
            return (
              <Badge
                key={pid}
                variant={isCustom ? "default" : "outline"}
                className="font-normal"
              >
                {qty}× {name}
              </Badge>
            )
          })}
        {!isEmpty && isCustom && (
          <Badge variant="secondary" className="text-[10px] uppercase">
            Custom
          </Badge>
        )}
        {!isEmpty && !isCustom && (
          <span className="text-[10px] uppercase text-muted-foreground">
            Default
          </span>
        )}
      </button>
      {isCustom && onResetToDefault && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onResetToDefault()
          }}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline focus:underline focus:outline-none"
        >
          Reset to default
        </button>
      )}
    </div>
  )
}

function PersonFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialValue,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (person: {
    email: string
    first_name: string
    last_name: string
  }) => boolean
  initialValue?: { first_name: string; last_name: string; email: string }
}) {
  const isEdit = initialValue !== undefined
  const [firstName, setFirstName] = useState(initialValue?.first_name ?? "")
  const [lastName, setLastName] = useState(initialValue?.last_name ?? "")
  const [email, setEmail] = useState(initialValue?.email ?? "")
  const [emailError, setEmailError] = useState<string | undefined>(undefined)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validatePerson({
      first_name: firstName,
      last_name: lastName,
      email,
    })
    if (errors.email) {
      setEmailError(errors.email)
      return
    }
    setEmailError(undefined)
    const ok = onSubmit({
      first_name: firstName,
      last_name: lastName,
      email,
    })
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit person" : "Add person"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this person's details."
              : "Add a single person to the grant list. Email is required."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="person-first-name">First name</Label>
              <Input
                id="person-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="person-last-name">Last name</Label>
              <Input
                id="person-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="person-email">Email</Label>
            <Input
              id="person-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(undefined)
              }}
              className={
                emailError ? "border-destructive text-destructive" : ""
              }
              aria-invalid={!!emailError}
              required
            />
            {emailError && (
              <p className="text-xs text-destructive">{emailError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save" : "Add person"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDeleteDialog({
  open,
  onOpenChange,
  person,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: PersonRow | null
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove person</DialogTitle>
          <DialogDescription>
            {person ? (
              <>
                This will remove <strong>{person.email}</strong> from the grant
                list. The person is not deleted from any other system.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmResetAllDialog({
  open,
  onOpenChange,
  overrideCount,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  overrideCount: number
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset all overrides?</DialogTitle>
          <DialogDescription>
            {overrideCount === 1
              ? "1 person has a custom product list. They will be reset to inherit the default."
              : `${overrideCount} people have custom product lists. They will be reset to inherit the default.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Reset all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonProductsDialog({
  open,
  onOpenChange,
  person,
  products,
  defaultProducts,
  onUseDefault,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: PersonRow
  products: ProductPublic[]
  defaultProducts: Record<string, number>
  onUseDefault: () => void
  onSave: (override: Record<string, number>) => void
}) {
  const seed = person.productsOverride ?? defaultProducts
  const [selection, setSelection] = useState<Record<string, number>>(() => ({
    ...seed,
  }))

  const toggle = (productId: string, checked: boolean) => {
    setSelection((prev) => {
      const next = { ...prev }
      if (checked) {
        next[productId] = next[productId] ?? 1
      } else {
        delete next[productId]
      }
      return next
    })
  }
  const setQty = (productId: string, qty: number) => {
    setSelection((prev) => ({ ...prev, [productId]: qty }))
  }

  const hasAny = Object.values(selection).some((q) => q >= 1)
  const isAlreadyDefault = person.productsOverride === null

  const displayName =
    [person.first_name, person.last_name].filter(Boolean).join(" ") ||
    person.email

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tickets for {displayName}</DialogTitle>
          <DialogDescription>
            Defaults applied unless you customize here.
          </DialogDescription>
        </DialogHeader>
        {products.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            This popup has no products.
          </div>
        ) : (
          <ProductsTable
            products={products}
            productQty={selection}
            onToggle={toggle}
            onQty={setQty}
            overdrawnInfo={new Map()}
            stockErrorPid={null}
          />
        )}
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={onUseDefault}
            disabled={isAlreadyDefault}
          >
            Use default
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => onSave(selection)}
              disabled={!hasAny}
              title={
                hasAny ? undefined : "Pick at least one product, or use default"
              }
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface OverdrawInfo {
  needed: number
  available: number | null
  overdrawn: boolean
  overMaxPerOrder: boolean
  maxPerOrder: number | null
}

function ProductsTable({
  products,
  productQty,
  onToggle,
  onQty,
  overdrawnInfo,
  stockErrorPid,
}: {
  products: ProductPublic[]
  productQty: Record<string, number>
  onToggle: (id: string, checked: boolean) => void
  onQty: (id: string, qty: number) => void
  overdrawnInfo: Map<string, OverdrawInfo>
  stockErrorPid: string | null
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Product</TableHead>
            <TableHead className="w-24 text-right">Stock</TableHead>
            <TableHead className="w-28">Qty / person</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const selected = p.id in productQty
            const info = overdrawnInfo.get(p.id)
            const overdrawn = info !== undefined
            const error = overdrawn && selected
            const highlighted =
              stockErrorPid === p.id || (overdrawn && selected)
            const reasons: string[] = []
            if (info && selected) {
              if (info.overdrawn && info.available !== null) {
                reasons.push(
                  `Needs ${info.needed} but only ${info.available} in stock.`,
                )
              }
              if (info.overMaxPerOrder && info.maxPerOrder !== null) {
                reasons.push(
                  `Exceeds max per order (${info.maxPerOrder}/order).`,
                )
              }
            }
            return (
              <TableRow
                key={p.id}
                className={highlighted ? "bg-destructive/10" : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(c) => onToggle(p.id, !!c)}
                    aria-label={`Select ${p.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{p.name}</span>
                    {p.category && (
                      <span className="text-xs text-muted-foreground">
                        {p.category}
                        {p.max_per_order != null
                          ? ` · max ${p.max_per_order}/order`
                          : ""}
                      </span>
                    )}
                    {reasons.length > 0 && (
                      <span className="mt-1 text-xs font-medium text-destructive">
                        {reasons.join(" ")}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm">
                  {p.total_stock_remaining == null ? (
                    <Badge variant="outline">∞</Badge>
                  ) : (
                    p.total_stock_remaining
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    disabled={!selected}
                    value={selected ? (productQty[p.id] ?? 1) : ""}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      onQty(
                        p.id,
                        Number.isFinite(v) && v > 0 ? Math.floor(v) : 1,
                      )
                    }}
                    className={
                      error ? "border-destructive text-destructive" : ""
                    }
                    aria-invalid={!!error}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
