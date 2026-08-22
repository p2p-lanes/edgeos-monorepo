import { Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import type { PortalPerson } from "./peopleProjection"

export function PeopleContent({ people }: { people: PortalPerson[] }) {
  const { t } = useTranslation()

  return (
    <section
      className="mx-auto max-w-3xl space-y-6 p-6"
      aria-labelledby="people-title"
    >
      <div>
        <h1 id="people-title" className="text-2xl font-semibold">
          {t("people.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("people.description")}
        </p>
      </div>

      {people.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <Users className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">{t("people.empty_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("people.empty_description")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {people.map((person) => (
            <li key={person.id} className="rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-medium">{person.name}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {t(`people.${person.relationship}`)}
                  </Badge>
                  {person.canManage && (
                    <Badge variant="outline">{t("people.can_manage")}</Badge>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
