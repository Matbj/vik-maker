"use client";

import { usePathname } from "next/navigation";
import { logout } from "@/app/logga-in/actions";

export function LogoutButton() {
  if (usePathname() === "/logga-in") return null;
  return (
    <form action={logout}>
      <button type="submit" className="text-sm font-medium text-white/85">
        Logga ut
      </button>
    </form>
  );
}
