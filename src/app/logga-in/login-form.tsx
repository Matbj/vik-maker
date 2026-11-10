"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "./actions";

const fieldClass =
  "w-full rounded-lg border border-black/10 bg-transparent px-3 py-3 text-base dark:border-white/10";
const buttonClass =
  "w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-50";
const linkClass = "text-sm font-medium text-accent disabled:opacity-50";

const initialState: LoginState = { step: "email" };

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);
  const next = useSearchParams().get("next") ?? "";

  if (state.step === "email") {
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="intent" value="send" />
        <label className="block space-y-1">
          <span className="text-sm font-medium">E-post</span>
          <input
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            defaultValue={state.email}
            className={fieldClass}
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          Mejla mig en kod
        </button>
        <Error message={state.error} />
      </form>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="email" value={state.email} />
      <input type="hidden" name="next" value={next} />
      {state.message && <p className="text-sm text-muted">{state.message}</p>}
      <label className="block space-y-1">
        <span className="text-sm font-medium">Kod</span>
        <input
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={4}
          className={`${fieldClass} font-mono tracking-[0.5em] uppercase`}
        />
      </label>
      <button type="submit" name="intent" value="verify" disabled={pending} className={buttonClass}>
        Logga in
      </button>
      <Error message={state.error} />
      <div className="flex justify-between gap-4">
        <button type="submit" name="intent" value="send" formNoValidate disabled={pending} className={linkClass}>
          Skicka en ny kod
        </button>
        <button type="submit" name="intent" value="restart" formNoValidate disabled={pending} className={linkClass}>
          Använd en annan e-postadress
        </button>
      </div>
    </form>
  );
}

function Error({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
