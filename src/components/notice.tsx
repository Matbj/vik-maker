export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted">{children}</div>
    </div>
  );
}
