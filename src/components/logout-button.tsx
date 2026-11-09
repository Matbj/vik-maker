"use client";

import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  if (usePathname() === "/login") return null;
  return (
    <form action={logout}>
      <button type="submit" className="text-sm font-medium text-muted">
        Log out
      </button>
    </form>
  );
}
