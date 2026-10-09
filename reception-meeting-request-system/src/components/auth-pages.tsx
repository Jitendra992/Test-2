import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, DoorOpen, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import type { AuthUser } from "@shared/api";
import { ApiError } from "@/lib/api-client";
import { createFirstAdmin, signIn } from "@/lib/auth-api";

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link href="/login" className="brand auth-brand">
          <span className="brand-mark"><DoorOpen size={19}/></span>
          <span><span className="brand-title">Reception</span><span className="brand-sub">Meeting Request System</span></span>
        </Link>
        {children}
        <div className="auth-security-note"><ShieldCheck size={15}/><span>Only accounts created by an Admin can sign in.</span></div>
      </section>
    </main>
  );
}

export function LoginPage({
  initialSetupAvailable,
  systemError,
  onSignIn,
}: {
  initialSetupAvailable: boolean;
  systemError?: string;
  onSignIn: (user: AuthUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      onSignIn(await signIn(email, password));
    } catch (issue) {
      setError(issue instanceof ApiError ? issue.message : "Could not sign in. Check the API connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return <AuthFrame>
    <div className="auth-heading"><span className="eyebrow">Authorized access</span><h1>Sign in</h1><p>Use the account created for you by your Admin.</p></div>
    <form className="auth-form" onSubmit={submit}>
      <div className="field"><label htmlFor="login-email">Email</label><input id="login-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required data-testid="input-login-email"/></div>
      <div className="field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required data-testid="input-login-password"/></div>
      {(error || systemError) && <div className="form-error" role="alert" data-testid="text-login-error">{error || systemError}</div>}
      <button type="submit" className="button auth-submit" disabled={busy} data-testid="button-login">{busy ? "Signing in…" : "Sign in"}<ArrowRight size={14}/></button>
    </form>
    {initialSetupAvailable && <div className="auth-setup-link"><span>First use?</span><Link href="/setup-admin">Set up the first Admin account <ArrowRight size={13}/></Link></div>}
  </AuthFrame>;
}

export function FirstAdminSetupPage({
  requiresToken,
  onCreated,
}: {
  requiresToken: boolean;
  onCreated: (user: AuthUser) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      onCreated(await createFirstAdmin({ name, email, password, ...(requiresToken ? { bootstrapToken } : {}) }));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create the first Admin account.");
    } finally {
      setBusy(false);
    }
  };

  return <AuthFrame>
    <div className="auth-heading"><span className="eyebrow">One-time setup</span><h1>Create the first Admin</h1><p>This closes automatically after the first account is created. Admins create all other accounts.</p></div>
    <form className="auth-form" onSubmit={submit}>
      <div className="field"><label htmlFor="setup-admin-name">Name</label><input id="setup-admin-name" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={120} required data-testid="input-admin-name"/></div>
      <div className="field"><label htmlFor="setup-admin-email">Email</label><input id="setup-admin-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required data-testid="input-admin-email"/></div>
      <div className="field"><label htmlFor="setup-admin-password">Password</label><input id="setup-admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required data-testid="input-admin-password"/><small className="field-help">Use at least 12 characters.</small></div>
      {requiresToken && <div className="field"><label htmlFor="setup-token">Setup token</label><input id="setup-token" type="password" value={bootstrapToken} onChange={event => setBootstrapToken(event.target.value)} autoComplete="off" required data-testid="input-admin-setup-token"/></div>}
      {error && <div className="form-error" role="alert" data-testid="text-admin-setup-error">{error}</div>}
      <button type="submit" className="button auth-submit" disabled={busy} data-testid="button-create-admin">{busy ? "Creating account…" : "Create Admin account"}<ArrowRight size={14}/></button>
    </form>
    <div className="auth-setup-link"><Link href="/login">Return to sign in</Link></div>
  </AuthFrame>;
}