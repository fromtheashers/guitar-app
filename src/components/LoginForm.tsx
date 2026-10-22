"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./LoginForm.module.css";

export function LoginForm() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the app. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <h1>Teacher sign-in</h1>
      <p className="muted">Enter the passcode to add songs, analyse videos and build setlists.</p>
      <label className="field">
        <span>Passcode</span>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          required
          autoFocus
        />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy || !passcode}>
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={async () => {
        await fetch("/api/session", { method: "DELETE" });
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
