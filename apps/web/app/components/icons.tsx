import type { LucideIcon } from "lucide-react";

export function IconLabel(
  { icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode },
) {
  return (
    <span className="flex items-center gap-2">
      <Icon aria-hidden size={17} strokeWidth={1.8} />
      <span>{children}</span>
    </span>
  );
}
