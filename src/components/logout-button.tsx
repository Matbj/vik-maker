import { logout } from "@/app/logga-in/actions";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold dark:border-white/10"
      >
        Logga ut
      </button>
    </form>
  );
}
