"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkLoginCode, sendLoginCode } from "@/lib/auth/login-codes";
import { endSession, startSession } from "@/lib/auth/sessions";

export type LoginState = {
  step: "email" | "code";
  email?: string;
  message?: string;
  error?: string;
  /** The code is used up or expired, so only a new one can help. */
  codeExpired?: boolean;
};

const SENT_MESSAGE = "If that address belongs to a coach on svenskalag.se, a code is on its way.";

/** Only ever send people back to a page of this app. */
function safeNext(next: FormDataEntryValue | null) {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/";
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get("intent");
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());

  if (intent === "restart") return { step: "email" };
  if (!email.success) return { step: "email", error: "Enter a valid email address." };

  if (intent === "send") {
    try {
      await sendLoginCode(email.data);
    } catch (error) {
      console.error("sending a login code failed:", error);
      return { step: "email", email: email.data, error: "The email couldn't be sent. Try again in a moment." };
    }
    return { step: "code", email: email.data, message: SENT_MESSAGE };
  }

  const result = await checkLoginCode(email.data, String(formData.get("code") ?? ""));
  if (result.status === "wrong") {
    return { step: "code", email: email.data, error: "That code isn't right. Three wrong tries uses it up." };
  }
  if (result.status === "invalid") {
    return { step: "code", email: email.data, codeExpired: true, error: "This code no longer works. Send a new one." };
  }

  await startSession(result.coachId);
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  await endSession();
  redirect("/login");
}
