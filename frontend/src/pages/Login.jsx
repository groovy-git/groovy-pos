import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useApp } from "../store";
import { api } from "../lib/api";
import { Button, Field, Sheet } from "../components/ui";
import { unlockAudio } from "../lib/feedback";

export default function Login() {
  const { login, toast } = useApp();
  const [email, setEmail] = useState(() => localStorage.getItem("gp_last_email") || "");
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    unlockAudio();
    setErr("");
    setBusy(true);
    try {
      localStorage.setItem("gp_last_email", email.trim());
      await login(email.trim(), pwd);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <img className="logo" src="./logo.svg" alt="Groovy Fragrances" />
      <div className="tagline">Smell Of Perfection</div>
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginBottom: 16 }}>Staff login</h2>
        <Field label="Email">
          <input className="input" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" error={err}>
          <div className="input-wrap">
            <input className="input" type={show ? "text" : "password"} autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
            <button type="button" className="icon-btn suffix-btn" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </Field>
        <Button className="block big" loading={busy} type="submit">
          Log in
        </Button>
        <button type="button" className="btn ghost block mt" onClick={() => setForgot(true)}>
          Forgot password?
        </button>
      </form>
      <ForgotSheet open={forgot} onClose={() => setForgot(false)} defaultEmail={email} toast={toast} />
    </div>
  );
}

function ForgotSheet({ open, onClose, defaultEmail, toast }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(defaultEmail);
  const [otp, setOtp] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (fn) => {
    setErr("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Reset password">
      {step === 1 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await api("forgotPassword", { email: email.trim() });
              toast(r.message, "success", 4000);
              setStep(2);
            });
          }}
        >
          <p className="muted small" style={{ marginTop: 0 }}>We'll email a 6-digit code to your registered email.</p>
          <Field label="Email" error={err}>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button className="block" loading={busy} type="submit">Send code</Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await api("resetPassword", { email: email.trim(), otp, password: pwd });
              toast(r.message, "success");
              setStep(1);
              onClose();
            });
          }}
        >
          <Field label="6-digit code from email">
            <input className="input" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required />
          </Field>
          <Field label="New password" hint="At least 6 characters" error={err}>
            <input className="input" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} minLength={6} required />
          </Field>
          <Button className="block" loading={busy} type="submit">Change password</Button>
        </form>
      )}
    </Sheet>
  );
}
