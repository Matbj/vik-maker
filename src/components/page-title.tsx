"use client";

import { usePathname } from "next/navigation";

const titles: Record<string, string> = {
  "/": "Kommande träningar",
  "/truppen": "Truppen",
  "/installningar": "Inställningar",
  "/installningar/logging": "Logg",
  "/logga-in": "Logga in",
};

/** The page's heading, which lives in the header bar next to the crest. */
export function PageTitle() {
  const pathname = usePathname();
  const title = pathname.startsWith("/traningar/") ? "Träning" : titles[pathname];
  if (!title) return null;
  return <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{title}</h1>;
}
