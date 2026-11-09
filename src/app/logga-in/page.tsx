import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <p className="text-sm text-muted">Använd e-postadressen du har på svenskalag.se.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
