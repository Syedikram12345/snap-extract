"use client";

import { useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck, Sparkles, Zap } from "lucide-react";

type Provider = "local" | "gemini" | "openai";

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [provider, setProvider] = useState<Provider>("local");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/admin/provider", {
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();

        setLoggedIn(true);
        setProvider(data.provider);
      }
    } catch {
      // Ignore while logged out.
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();

    setBusy(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Login failed.");
        return;
      }

      setLoggedIn(true);
      setPassword("");

      await load();
    } catch {
      setMessage("Unable to connect to the server.");
    } finally {
      setBusy(false);
    }
  }

  async function changeProvider(next: Provider) {
    setBusy(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/provider", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: next,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Could not change provider.");
        return;
      }

      setProvider(next);

      const providerName =
        next === "local"
          ? "Local OCR"
          : next === "gemini"
            ? "Gemini"
            : "OpenAI";

      setMessage(`Global provider switched to ${providerName}.`);
    } catch {
      setMessage("Unable to connect to the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!loggedIn) {
    return (
      <main className="admin-page">
        <div className="admin-card">
          <div className="admin-icon">
            <LockKeyhole />
          </div>

          <h1>SnapExtract Admin</h1>

          <p className="hero-copy">
            Private control panel. Only the admin password can access this page.
          </p>

          <form onSubmit={login}>
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
            />

            <button
              className="primary admin-button"
              disabled={busy || !password}
            >
              {busy ? "Unlocking..." : "Unlock"}
            </button>
          </form>

          {message && <p className="status error">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <div className="admin-card wide">
        <div className="admin-top">
          <div>
            <div className="eyebrow">PRIVATE ADMIN</div>

            <h1>OCR Provider</h1>
          </div>

          <ShieldCheck />
        </div>

        <p className="muted large">
          Choose which extraction engine every visitor uses.
        </p>

        <div className="provider-grid">
          {/* LOCAL */}
          <button
            className={`provider-card ${
              provider === "local" ? "selected" : ""
            }`}
            onClick={() => changeProvider("local")}
            disabled={busy}
          >
            <div className="provider-icon">
              <ShieldCheck />
            </div>

            <h2>Local OCR</h2>

            <p>Completely free · private · no API key</p>

            <strong>
              {provider === "local" ? "ACTIVE" : "Switch to Local"}
            </strong>
          </button>

          {/* GEMINI */}
          <button
            className={`provider-card ${
              provider === "gemini" ? "selected" : ""
            }`}
            onClick={() => changeProvider("gemini")}
            disabled={busy}
          >
            <div className="provider-icon">
              <Sparkles />
            </div>

            <h2>Gemini</h2>

            <p>Free tier · AI vision · no OpenAI required</p>

            <strong>
              {provider === "gemini" ? "ACTIVE" : "Switch to Gemini"}
            </strong>
          </button>

          {/* OPENAI */}
          <button
            className={`provider-card ${
              provider === "openai" ? "selected" : ""
            }`}
            onClick={() => changeProvider("openai")}
            disabled={busy}
          >
            <div className="provider-icon">
              <Zap />
            </div>

            <h2>OpenAI</h2>

            <p>Advanced AI extraction · API usage</p>

            <strong>
              {provider === "openai" ? "ACTIVE" : "Switch to OpenAI"}
            </strong>
          </button>
        </div>

        {message && <p className="status">{message}</p>}

        <a className="admin-back" href="/">
          ← Back to SnapExtract
        </a>
      </div>
    </main>
  );
}
