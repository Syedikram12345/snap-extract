import Extractor from "@/components/Extractor";

export default function Home() {
  return (
    <main>
      <header className="nav">
        <a className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SnapExtract</span>
        </a>
        <span className="nav-pill">Free to try · Privacy-first</span>
      </header>

      <section className="hero">
        <div className="eyebrow">SCREENSHOT → USABLE CONTENT</div>
        <h1>Turn screenshots into <span>clean text & code.</span></h1>
        <p className="hero-copy">
          Upload a screenshot, paste an image, or drop a file. Extract text, code,
          tables and URLs without typing everything by hand.
        </p>
        <Extractor />
      </section>

      <section className="features">
        <div><b>⚡ Instant extraction</b><p>Upload or paste and get editable results in seconds.</p></div>
        <div><b>💻 Code-aware</b><p>Preserve indentation and format common programming languages.</p></div>
        <div><b>🔒 Privacy-first</b><p>Images are processed on demand and aren't stored by this app.</p></div>
      </section>

      <footer>© {new Date().getFullYear()} SnapExtract · Built for people who hate retyping screenshots.</footer>
    </main>
  );
}
