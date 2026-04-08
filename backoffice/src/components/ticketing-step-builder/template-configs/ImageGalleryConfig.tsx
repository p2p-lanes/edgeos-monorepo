import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Check,
  GripVertical,
  ImageIcon,
  Link,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useFileUpload } from "@/hooks/useFileUpload"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GalleryImage {
  id: string
  url: string
  caption?: string
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const GALLERY_VARIANTS = [
  {
    value: "carousel",
    label: "Carousel",
    description: "Full-width slider with arrows",
  },
  {
    value: "masonry",
    label: "Masonry",
    description: "Staggered grid layout",
  },
  {
    value: "lightbox",
    label: "Lightbox",
    description: "Thumbnails with full-screen preview",
  },
  {
    value: "slideshow",
    label: "Slideshow",
    description: "Auto-playing fade transitions",
  },
] as const

// ---------------------------------------------------------------------------
// Variant previews
// ---------------------------------------------------------------------------

function CarouselPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="h-7 rounded bg-muted-foreground/10 relative overflow-hidden">
        <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />
        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />
      </div>
      <div className="flex justify-center gap-0.5">
        <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
        <div className="w-1 h-1 rounded-full bg-muted-foreground/15" />
        <div className="w-1 h-1 rounded-full bg-muted-foreground/15" />
      </div>
    </div>
  )
}

function MasonryPreview() {
  return (
    <div className="grid grid-cols-2 gap-0.5 w-full">
      <div className="flex flex-col gap-0.5">
        <div className="h-5 rounded-sm bg-muted-foreground/10" />
        <div className="h-3 rounded-sm bg-muted-foreground/10" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="h-3 rounded-sm bg-muted-foreground/10" />
        <div className="h-5 rounded-sm bg-muted-foreground/10" />
      </div>
    </div>
  )
}

function LightboxPreview() {
  return (
    <div className="grid grid-cols-3 gap-0.5 w-full">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="aspect-square rounded-sm bg-muted-foreground/10"
        />
      ))}
    </div>
  )
}

function SlideshowPreview() {
  return (
    <div className="relative w-full h-7">
      <div className="absolute inset-0 rounded bg-muted-foreground/5" />
      <div
        className="absolute inset-0 rounded bg-muted-foreground/10"
        style={{ clipPath: "inset(0 30% 0 0)" }}
      />
      <div className="absolute bottom-0.5 right-1 flex items-center gap-0.5">
        <div className="w-1 h-1 rounded-full bg-muted-foreground/20" />
        <div className="w-1 h-1 border-l border-b border-muted-foreground/25 rotate-45" />
      </div>
    </div>
  )
}

const VARIANT_PREVIEW_MAP: Record<string, React.FC> = {
  carousel: CarouselPreview,
  masonry: MasonryPreview,
  lightbox: LightboxPreview,
  slideshow: SlideshowPreview,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseImages(config: Record<string, unknown> | null): GalleryImage[] {
  if (!config || !Array.isArray(config.images)) return []
  return config.images as GalleryImage[]
}

// ---------------------------------------------------------------------------
// Sortable image card
// ---------------------------------------------------------------------------

function SortableImageCard({
  image,
  onUpdateCaption,
  onDelete,
}: {
  image: GalleryImage
  onUpdateCaption: (id: string, caption: string) => void
  onDelete: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0">
        <img
          src={image.url}
          alt={image.caption || ""}
          className="w-full h-full object-cover"
        />
      </div>

      <Input
        value={image.caption || ""}
        onChange={(e) => onUpdateCaption(image.id, e.target.value)}
        placeholder="Caption (optional)"
        className="h-7 text-xs flex-1 min-w-0"
      />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(image.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add image section
// ---------------------------------------------------------------------------

function AddImageSection({ onAdd }: { onAdd: (url: string) => void }) {
  const [mode, setMode] = useState<"upload" | "url">("upload")
  const [urlValue, setUrlValue] = useState("")
  const { uploadFile, uploadProgress, reset, isUploading } = useFileUpload()
  const [dragActive, setDragActive] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await uploadFile(file)
        onAdd(result.publicUrl)
        reset()
      } catch {
        // Error handled by hook
      }
    },
    [uploadFile, onAdd, reset],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      if (isUploading) return
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [isUploading, handleFile],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      e.target.value = ""
    },
    [handleFile],
  )

  const handleUrlSubmit = () => {
    const trimmed = urlValue.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setUrlValue("")
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-lg border p-0.5 w-fit">
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "upload"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Upload className="h-3 w-3" />
          Upload
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "url"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Link className="h-3 w-3" />
          URL
        </button>
      </div>

      {mode === "upload" ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone
        <div
          role="presentation"
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
            dragActive && "border-primary bg-primary/5",
            uploadProgress.status === "error" && "border-destructive",
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Uploading... {uploadProgress.progress}%
              </p>
              <div className="w-full max-w-xs bg-secondary rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${uploadProgress.progress}%` }}
                />
              </div>
            </div>
          ) : uploadProgress.status === "error" ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-destructive">{uploadProgress.error}</p>
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                Try Again
              </Button>
            </div>
          ) : (
            <label className="flex flex-col items-center gap-1.5 cursor-pointer">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Drag & drop or click to upload
              </p>
              <p className="text-[10px] text-muted-foreground">
                PNG, JPG, GIF, WebP up to 10MB
              </p>
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileInput}
              />
            </label>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://example.com/image.jpg"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleUrlSubmit}
            disabled={!urlValue.trim()}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImageGalleryConfig({ config, onChange }: TemplateConfigProps) {
  const variant = (config?.variant as string) || "carousel"
  const images = parseImages(config)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const updateImages = (updated: GalleryImage[]) => {
    onChange({ ...config, images: updated })
  }

  const handleAddImage = (url: string) => {
    const newImage: GalleryImage = {
      id: crypto.randomUUID(),
      url,
      caption: "",
    }
    updateImages([...images, newImage])
  }

  const handleUpdateCaption = (id: string, caption: string) => {
    updateImages(
      images.map((img) => (img.id === id ? { ...img, caption } : img)),
    )
  }

  const handleDeleteImage = (id: string) => {
    updateImages(images.filter((img) => img.id !== id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = images.findIndex((img) => img.id === active.id)
    const newIndex = images.findIndex((img) => img.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    updateImages(arrayMove(images, oldIndex, newIndex))
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Variant selector */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">Gallery Layout</Label>
          <p className="text-xs text-muted-foreground">
            Choose how images are displayed in the checkout
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GALLERY_VARIANTS.map((v) => {
            const isActive = variant === v.value
            const Preview = VARIANT_PREVIEW_MAP[v.value]
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    variant: v.value === "carousel" ? undefined : v.value,
                  })
                }
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-center transition-all hover:bg-accent/50",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </div>
                )}
                <div className="w-full px-1">
                  <Preview />
                </div>
                <div>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      isActive && "text-primary",
                    )}
                  >
                    {v.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {v.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Separator />

      {/* Add images */}
      <div>
        <Label className="text-sm font-medium">Images</Label>
        <p className="text-xs text-muted-foreground mb-3">
          Upload images or paste URLs to build your gallery
        </p>
        <AddImageSection onAdd={handleAddImage} />
      </div>

      {/* Image list */}
      {images.length > 0 && (
        <>
          <Separator />
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Gallery ({images.length} image{images.length !== 1 ? "s" : ""})
            </Label>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={images.map((img) => img.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {images.map((image) => (
                    <SortableImageCard
                      key={image.id}
                      image={image}
                      onUpdateCaption={handleUpdateCaption}
                      onDelete={handleDeleteImage}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </>
      )}

      {images.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No images added yet. Upload or paste a URL above.
          </p>
        </div>
      )}
    </div>
  )
}
