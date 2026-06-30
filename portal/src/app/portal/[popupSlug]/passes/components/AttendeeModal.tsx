"use client"

import { useEffect, useState } from "react"
import type { AttendeeCategoryPublic } from "@/client"
import { Button, ButtonAnimated } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Modal from "@/components/ui/modal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AttendeePassState } from "@/types/Attendee"

interface AttendeeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (
    data: AttendeePassState & { category_id?: string },
  ) => Promise<void>
  category: AttendeeCategoryPublic
  editingAttendee: AttendeePassState | null
  isDelete?: boolean
}

interface RequiredField {
  name: string
  /** Optional display label override; falls back to humanized name. */
  label?: string
  type: "email" | "text" | "select" | "number"
  required?: boolean
  /** Options accept plain strings or {value,label} objects for select fields. */
  options?: Array<string | { value: string; label: string }>
  display_as_subtitle?: boolean
}

function normalizeOption(opt: string | { value: string; label: string }): {
  value: string
  label: string
} {
  if (typeof opt === "string") return { value: opt, label: opt }
  return opt
}

const defaultFormData = {
  name: "",
  gender: "",
}

type FormDataState = {
  name: string
  gender: string
  [key: string]: string
}

export function AttendeeModal({
  onSubmit,
  open,
  onClose,
  category,
  editingAttendee,
  isDelete,
}: AttendeeModalProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<FormDataState>(defaultFormData)
  const [errors, setErrors] = useState<{ [key: string]: boolean }>({})

  const requiredFields: RequiredField[] = (category.required_fields ??
    []) as unknown as RequiredField[]

  useEffect(() => {
    const fields = (category.required_fields ??
      []) as unknown as RequiredField[]
    if (editingAttendee) {
      const initial: FormDataState = {
        name: editingAttendee.name ?? "",
        gender: editingAttendee.gender ?? "",
      }
      // Populate dynamic fields from additional_data if available
      for (const field of fields) {
        const existing = (editingAttendee as Record<string, unknown>)
          .additional_data
        if (
          existing &&
          typeof existing === "object" &&
          field.name in (existing as Record<string, unknown>)
        ) {
          initial[field.name] = String(
            (existing as Record<string, string>)[field.name] ?? "",
          )
        }
      }
      setFormData(initial)
    } else {
      setFormData(defaultFormData)
    }
    setErrors({})
  }, [editingAttendee, category.required_fields])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: { [key: string]: boolean } = {}

    if (!formData.name.trim()) {
      newErrors.name = true
    }

    // Validate dynamic required fields
    for (const field of requiredFields) {
      if (field.required && !formData[field.name]?.trim()) {
        newErrors[field.name] = true
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    setLoading(true)

    // Build additional_data from dynamic fields
    const additionalData: Record<string, string> = {}
    for (const field of requiredFields) {
      if (formData[field.name]) {
        additionalData[field.name] = formData[field.name]
      }
    }

    try {
      await onSubmit({
        ...(editingAttendee ?? ({} as AttendeePassState)),
        name: formData.name,
        gender: formData.gender,
        email: formData.email ?? editingAttendee?.email ?? "",
        category_id: category.id,
        id: editingAttendee?.id ?? "",
        // Pass email from dynamic fields if present
        ...(formData.email ? { email: formData.email } : {}),
        // Persist declarative required_fields answers (e.g. age_group)
        additional_data: additionalData,
      } as AttendeePassState & { category_id?: string })
    } finally {
      setLoading(false)
    }
  }

  const categoryLabel =
    (category.display_meta as Record<string, unknown>)?.label ??
    category.key.charAt(0).toUpperCase() + category.key.slice(1)

  const title = editingAttendee
    ? `Edit ${editingAttendee.name}`
    : `Add ${categoryLabel}`
  const description = `Enter the details of your ${categoryLabel} here. Click save when you're done.`

  if (isDelete) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={`Delete ${editingAttendee?.name}`}
        description={`Are you sure you want to delete this ${categoryLabel}?`}
      >
        <DialogFooter>
          <Button
            className="bg-destructive hover:bg-destructive/90 text-primary-foreground"
            disabled={loading}
            onClick={handleSubmit}
          >
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
    >
      <form noValidate onSubmit={handleSubmit}>
        <div className="grid gap-4 py-4">
          {/* Name — always required */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className={`col-span-3 ${errors.name ? "border-destructive" : ""}`}
              required
            />
          </div>

          {/* Dynamic fields from required_fields schema (email, gender, age, ...) */}
          {requiredFields.map((field) => (
            <DynamicField
              key={field.name}
              field={field}
              value={formData[field.name] ?? ""}
              hasError={!!errors[field.name]}
              onChange={(val) =>
                setFormData((prev) => ({ ...prev, [field.name]: val }))
              }
            />
          ))}
        </div>
        <DialogFooter>
          <ButtonAnimated loading={loading} type="submit">
            {editingAttendee ? "Update" : "Save"}
          </ButtonAnimated>
        </DialogFooter>
      </form>
    </Modal>
  )
}

function DynamicField({
  field,
  value,
  hasError,
  onChange,
}: {
  field: RequiredField
  value: string
  hasError: boolean
  onChange: (val: string) => void
}) {
  const labelText =
    field.label && field.label.trim() !== ""
      ? field.label
      : field.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const errorClass = hasError ? "border-destructive" : ""

  if (field.type === "select" && field.options) {
    const options = field.options.map(normalizeOption)
    return (
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={field.name} className="text-right">
          {labelText}
          {field.required && <span className="text-destructive"> *</span>}
        </Label>
        <Select
          value={value}
          onValueChange={onChange}
          required={field.required}
        >
          <SelectTrigger className={`col-span-3 ${errorClass}`}>
            <SelectValue placeholder={`Select ${labelText.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 items-center gap-4">
      <Label htmlFor={field.name} className="text-right">
        {labelText}
        {field.required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={field.name}
        type={field.type === "email" ? "email" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`col-span-3 ${errorClass}`}
        required={field.required}
      />
    </div>
  )
}
