"use client";

import { useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck, Zap } from "lucide-react";

type Provider = "local" | "openai";

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [provider, setProvider] = useState<Provider>("local");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/provider", { cache: "no-store" });
    if (res.ok) { const data = await res.json(); setLoggedIn(true); setProvider(data.provider); }
  }
  useEffect(() => { load(); }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage("");
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await res.json();
    if (!res.ok) setMessage(data.error || "Login failed."); else { setLoggedIn(true); setPassword(""); await load(); }
    setBusy(false);
  }

  async function changeProvider(next: Provider) {
    setBusy(true); setMessage("");
    const res = await fetch("/api/admin/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: next }) });
    const data = await res.json();
    if (!res.ok) setMessage(data.error || "Could not change provider."); else { setProvider(next); setMessage(`Global provider switched to ${next === "local" ? "Local OCR" : "OpenAI"}.`); }
    setBusy(false);
  }

  if (!loggedIn) return <main className="admin-page"><div className="admin-card"><div className="admin-icon"><LockKeyhole/></div><h1>SnapExtract Admin</h1><p className="hero-copy">Private control panel. Only the admin password can access this page.</p><form onSubmit={login}><input className="admin-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Admin password" autoFocus/><button className="primary admin-button" disabled={busy}>Unlock</button></form>{message && <p className="status error">{message}</p>}</div></main>;

  return <main className="admin-page"><div className="admin-card wide"><div className="admin-top"><div><div className="eyebrow">PRIVATE ADMIN</div><h1>OCR Provider</h1></div><ShieldCheck/></div><p className="muted large">Choose which engine every visitor uses. Local OCR requires no API key and keeps images in the browser. OpenAI enables stronger AI extraction when your API key and billing are ready.</p><div className="provider-grid"><button className={`provider-card ${provider === "local" ? "selected" : ""}`} onClick={() => changeProvider("local")} disabled={busy}><div className="provider-icon"><ShieldCheck/></div><h2>Local OCR</h2><p>Free · private · no API key</p><strong>{provider === "local" ? "ACTIVE" : "Switch to Local"}</strong></button><button className={`provider-card ${provider === "openai" ? "selected" : ""}`} onClick={() => changeProvider("openai")} disabled={busy}><div className="provider-icon"><Zap/></div><h2>OpenAI</h2><p>AI-powered · API usage</p><strong>{provider === "openai" ? "ACTIVE" : "Switch to OpenAI"}</strong></button></div>{message && <p className="status">{message}</p>}<a className="admin-back" href="/">← Back to SnapExtract</a></div></main>;
}
