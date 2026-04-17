"use client"

import Link from "next/link"
import { useTranslation } from "react-i18next"

export default function NotFound() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100">
      <div className="text-center max-w-md p-8">
        <h1 className="text-6xl font-bold text-neutral-900 mb-4">
          {t("errors.not_found")}
        </h1>
        <p className="text-lg text-neutral-600 mb-8">
          {t("errors.page_not_found")}
        </p>
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-black px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
        >
          {t("common.go_back_home")}
        </Link>
      </div>
    </div>
  )
}
