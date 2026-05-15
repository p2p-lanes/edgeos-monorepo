"use client"

import { Download, PenLine, Upload, X } from "lucide-react"
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import type { SignatureConfig, SignatureValue } from "../../types"
import { cn } from "../../utils"
import { useFileUploadFn } from "../FileUploadProvider"
import { FormInputWrapper } from "../FormInputWrapper"
import { Input } from "../Input"
import { LabelMuted, LabelRequired } from "../Label"

const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 200
const SIGNATURE_FILENAME = "signature.png"

export interface SignatureFormProps {
  id: string
  label?: string
  subtitle?: string
  config?: SignatureConfig
  value?: SignatureValue
  onChange?: (value: SignatureValue) => void
  error?: string
  isRequired?: boolean
  disabled?: boolean
  readOnly?: boolean
}

type Mode = "draw" | "type" | "upload"

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, b64] = dataUrl.split(",")
  const mime = meta.match(/data:(.*?);/)?.[1] ?? "image/png"
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new File([buf], filename, { type: mime })
}

interface DrawCanvasProps {
  onChange: (dataUrl: string | null) => void
}

function DrawCanvas({ onChange }: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const hasInk = useRef(false)

  const getCtx = () => {
    const c = canvasRef.current
    if (!c) return null
    const ctx = c.getContext("2d")
    if (!ctx) return null
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 2
    ctx.strokeStyle = "#111827"
    return ctx
  }

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    }
  }

  const handleDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true
    lastPoint.current = point(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = getCtx()
    const p = point(e)
    if (ctx && lastPoint.current) {
      ctx.beginPath()
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      hasInk.current = true
    }
    lastPoint.current = p
  }

  const handleUp = () => {
    drawing.current = false
    lastPoint.current = null
    if (hasInk.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"))
    }
  }

  const clear = () => {
    const c = canvasRef.current
    const ctx = getCtx()
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    hasInk.current = false
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full rounded-md border bg-white touch-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      />
      <button
        type="button"
        onClick={clear}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Clear
      </button>
    </div>
  )
}

interface TypeCanvasProps {
  text: string
  onText: (text: string) => void
  onRender: (dataUrl: string | null) => void
}

function TypeCanvas({ text, onText, onRender }: TypeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!text.trim()) {
      onRender(null)
      return
    }
    ctx.fillStyle = "#111827"
    ctx.font = "italic 48px 'Brush Script MT', cursive, serif"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.fillText(text, c.width / 2, c.height / 2)
    onRender(c.toDataURL("image/png"))
  }, [text, onRender])

  return (
    <div className="space-y-2">
      <Input
        type="text"
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder="Type your name"
      />
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full rounded-md border bg-white"
      />
    </div>
  )
}

export function SignatureForm({
  id,
  label,
  subtitle,
  config,
  value,
  onChange,
  error,
  isRequired,
  disabled,
  readOnly,
}: SignatureFormProps) {
  const uploadFn = useFileUploadFn()
  const pdfUrl = config?.pdf_url
  const requireDate = !!config?.require_date

  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("draw")
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null)
  const [typedName, setTypedName] = useState("")
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const canSign = !disabled && !readOnly && !!uploadFn

  const signature = value?.signature
  const signedAt = value?.signed_at

  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!uploadFn) return
      setBusy(true)
      setLocalError(null)
      try {
        const result = await uploadFn(file)
        onChange?.({
          signature: result.publicUrl,
          signed_at: signedAt,
        })
        setModalOpen(false)
        setPendingDataUrl(null)
        setTypedName("")
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setBusy(false)
      }
    },
    [uploadFn, onChange, signedAt],
  )

  const handleDone = useCallback(async () => {
    if (!pendingDataUrl) {
      setLocalError("Please add a signature first")
      return
    }
    const file = dataUrlToFile(pendingDataUrl, SIGNATURE_FILENAME)
    await handleUploadFile(file)
  }, [pendingDataUrl, handleUploadFile])

  const handleUploadInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (f) handleUploadFile(f)
  }

  const handleClearSignature = () => {
    onChange?.({ signature: undefined, signed_at: signedAt })
  }

  const handleDateChange = (date: string) => {
    onChange?.({ signature, signed_at: date })
  }

  const openModal = () => {
    setPendingDataUrl(null)
    setTypedName("")
    setLocalError(null)
    setMode("draw")
    setModalOpen(true)
  }

  return (
    <FormInputWrapper>
      {label && <LabelRequired isRequired={isRequired}>{label}</LabelRequired>}
      {subtitle && (
        <LabelMuted className="text-sm text-muted-foreground">
          {subtitle}
        </LabelMuted>
      )}

      <div className="rounded-lg border bg-blue-50/40">
        <div className="flex items-center justify-between border-b bg-blue-100/40 px-4 py-2">
          <span className="text-sm font-medium">Agreement</span>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline"
            >
              <Download className="h-3 w-3" /> Download
            </a>
          )}
        </div>
        {pdfUrl ? (
          <iframe
            title="Agreement PDF"
            src={pdfUrl}
            className="h-72 w-full"
          />
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No document attached
          </div>
        )}
      </div>

      <div
        className={cn(
          "mt-3 flex flex-wrap items-start gap-3",
          requireDate ? "md:flex-nowrap" : "",
        )}
      >
        <div className="flex-1 min-w-0">
          {readOnly ? (
            <div className="flex h-10 items-center justify-center rounded-md border border-dashed bg-muted/40 text-xs text-muted-foreground">
              User will sign here
            </div>
          ) : signature ? (
            <div className="relative inline-block">
              <img
                src={signature}
                alt="Signature"
                className="h-10 rounded-md border bg-white object-contain"
              />
              {canSign && (
                <button
                  type="button"
                  aria-label="Remove signature"
                  onClick={handleClearSignature}
                  className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              id={id}
              disabled={!canSign}
              onClick={openModal}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm",
                canSign ? "hover:bg-muted" : "cursor-not-allowed opacity-60",
              )}
              title={
                !uploadFn ? "Signing is not available in this view" : undefined
              }
            >
              <PenLine className="h-4 w-4" /> Add signature
            </button>
          )}
        </div>
        {requireDate && (
          <div className="flex-1 min-w-0">
            <Input
              type="date"
              value={signedAt ?? ""}
              onChange={(e) => handleDateChange(e.target.value)}
              disabled={disabled || readOnly}
              className="h-10"
            />
          </div>
        )}
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {modalOpen && canSign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Sign document</span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex">
              <nav className="flex w-32 flex-col border-r p-2">
                {(["draw", "type", "upload"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m)
                      setPendingDataUrl(null)
                    }}
                    className={cn(
                      "rounded-md px-3 py-2 text-left text-sm capitalize",
                      mode === m
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </nav>
              <div className="flex-1 p-4 space-y-3">
                {mode === "draw" && (
                  <DrawCanvas onChange={setPendingDataUrl} />
                )}
                {mode === "type" && (
                  <TypeCanvas
                    text={typedName}
                    onText={setTypedName}
                    onRender={setPendingDataUrl}
                  />
                )}
                {mode === "upload" && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Upload className="h-4 w-4" /> Choose image
                    </button>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleUploadInput}
                    />
                    <p className="text-xs text-muted-foreground">
                      Upload a transparent PNG or JPG of your signature.
                    </p>
                  </div>
                )}
                {localError && (
                  <p className="text-sm text-red-500">{localError}</p>
                )}
                {mode !== "upload" && (
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setModalOpen(false)}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDone}
                      disabled={!pendingDataUrl || busy}
                      className={cn(
                        "rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground",
                        (!pendingDataUrl || busy) &&
                          "cursor-not-allowed opacity-60",
                      )}
                    >
                      {busy ? "Saving…" : "Done"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </FormInputWrapper>
  )
}
