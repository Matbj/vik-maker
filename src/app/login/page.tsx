import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <h1 className="text-xl font-semibold tracking-tight">Log in</h1>
      <p className="text-sm text-muted">Use the email address you have on svenskalag.se.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
