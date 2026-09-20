import { createFileRoute, Navigate } from "@tanstack/react-router";
import { CredentialSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAppConfig } from "@/config/app-config";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const config = getAppConfig();

  if (isPending) {
    return (
      <main className="auth-gate">
        <div className="auth-gate-card">
          <calcite-loader label="Checking session" />
        </div>
      </main>
    );
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <main className="auth-gate">
      <div className="auth-gate-card">
        <div className="auth-gate-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <div>
            <h1>{config.title}</h1>
            {config.subtitle ? <p>{config.subtitle}</p> : null}
          </div>
        </div>
        <p className="auth-gate-hint">Sign in with your User ID and password to open the workbench.</p>
        <CredentialSignIn />
      </div>
    </main>
  );
}
