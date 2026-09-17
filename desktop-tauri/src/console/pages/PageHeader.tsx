import type { ReactNode } from "react";

/** 页面头：标题 + 一句说明 + 右侧操作。全站统一节奏。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[860px] px-7 py-6">{children}</div>;
}
