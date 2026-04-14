const TitleTabs = ({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) => {
  return (
    <div className="flex flex-col gap-2 max-w-3xl">
      <h1 className="text-[34px]/[51px] font-semibold text-heading">{title}</h1>
      {subtitle && (
        <p className="text-regular text-heading-secondary">{subtitle}</p>
      )}
      {children && (
        <div className="text-regular text-heading-secondary">{children}</div>
      )}
    </div>
  )
}

export default TitleTabs
