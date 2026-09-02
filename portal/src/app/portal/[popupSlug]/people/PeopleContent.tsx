import { Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { getPersonInitials, orderPeopleForDisplay } from "./peoplePresentation"
import type { PortalPerson } from "./peopleProjection"

export function PeopleContent({ people }: { people: PortalPerson[] }) {
  const { t } = useTranslation()

  return (
    <section
      className="mx-auto max-w-4xl space-y-6 p-6"
      aria-labelledby="people-title"
    >
      <div>
        <h1 id="people-title" className="text-3xl font-semibold tracking-tight">
          {t("people.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("people.description")}
        </p>
      </div>

      {people.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-10 text-center shadow-sm">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <h2 className="mt-3 font-semibold">{t("people.empty_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("people.empty_description")}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {orderPeopleForDisplay(people).map((person) => (
            <li
              key={person.id}
              className="flex flex-wrap items-center gap-4 border-b p-4 last:border-b-0 sm:p-5"
            >
              <span
                className={
                  person.relationship === "primary"
                    ? "grid size-11 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                    : "grid size-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
                }
                aria-hidden="true"
              >
                {getPersonInitials(person.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{person.name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    person.relationship === "primary" ? "default" : "secondary"
                  }
                >
                  {t(`people.${person.relationship}`)}
                </Badge>
                {person.canManage && (
                  <Badge variant="outline">{t("people.can_manage")}</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
