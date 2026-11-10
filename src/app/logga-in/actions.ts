"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit, recordLogin } from "@/lib/audit";
import { checkLoginCode, sendLoginCode } from "@/lib/auth/login-codes";
import { endSession, startSession } from "@/lib/auth/sessions";

export type LoginState = {
  step: "email" | "code";
  email?: string;
  message?: string;
  error?: string;
};

const SENT_MESSAGE = "Om adressen tillhör en ledare på svenskalag.se är en kod på väg.";

const THIS_APP = "https://vik-playmaker.invalid";

/**
 * Only ever send people back to a page of this app. The address is resolved the
 * way a browser does, as browsers drop tabs and newlines and read \ as /.
 */
function safeNext(next: FormDataEntryValue | null) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  const url = URL.canParse(next, THIS_APP) ? new URL(next, THIS_APP) : null;
  if (url?.origin !== THIS_APP || url.pathname.startsWith("//")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get("intent");
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());

  if (intent === "restart") return { step: "email" };
  if (!email.success) return { step: "email", error: "Ange en giltig e-postadress." };

  if (intent === "send") {
    try {
      await sendLoginCode(email.data);
    } catch (error) {
      console.error("sending a login code failed:", error);
      return { step: "email", email: email.data, error: "Mejlet kunde inte skickas. Försök igen om en liten stund." };
    }
    return { step: "code", email: email.data, message: SENT_MESSAGE };
  }

  const result = await checkLoginCode(email.data, String(formData.get("code") ?? ""));
  if (result.status === "failed") {
    return { step: "code", email: email.data, error: "Koden stämmer inte eller gäller inte längre. Efter tre felaktiga försök behöver du en ny kod." };
  }

  await startSession(result.coachId);
  await recordLogin(result.coachId);
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  await recordAudit("logout");
  await endSession();
  redirect("/logga-in");
}
