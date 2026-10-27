import { isEditor, passcodeConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

/** Returns a sign-in screen when the visitor isn't the teacher, otherwise null. */
export async function teacherGate() {
  if (!passcodeConfigured()) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h1>Set a teacher passcode first</h1>
        <p className="muted">Add EDITOR_PASSCODE in Vercel&apos;s Environment Variables (Settings), then redeploy.</p>
      </div>
    );
  }
  return (await isEditor()) ? null : <LoginForm />;
}
