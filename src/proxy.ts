import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/sessions";

/** Everything needs a logged-in coach, including Server Actions, which post to these paths. */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const loggedIn = token ? await isValidSession(token) : false;
  const { pathname, search } = request.nextUrl;

  if (pathname === "/login") {
    return loggedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (loggedIn) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // The cron route has its own bearer token.
  matcher: ["/((?!_next/static|_next/image|icon.png|apple-icon.png|api/cron/).*)"],
};
