export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-sm font-semibold tracking-tight text-white">
        K
      </span>
      {!compact && (
        <span className="text-[17px] font-semibold tracking-tight">KOAN</span>
      )}
    </span>
  );
}
