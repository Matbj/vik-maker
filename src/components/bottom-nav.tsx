"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Träningar" },
  { href: "/players", label: "Truppen" },
  { href: "/settings", label: "Inställningar" },
] as const;

/** Thumb-reachable tab bar on phones; sits at the bottom on all sizes for now. */
export function BottomNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-black/10 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10">
      <ul className="mx-auto flex max-w-3xl">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex h-14 items-center justify-center border-t-2 text-sm font-medium ${
                  active ? "border-gold text-accent" : "border-transparent text-muted"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
