import Extractor from "@/components/Extractor";
export const metadata = {
  title: "Screenshot to Code — Extract Code from Images | SnapExtract",
  description: "Extract clean, editable programming code from screenshots."
};
export default function ScreenshotToCode() {
  return <main><header className="nav"><a className="brand" href="/"><span className="brand-mark">S</span><span>SnapExtract</span></a></header><section className="hero"><div className="eyebrow">FOR DEVELOPERS</div><h1>Screenshot to <span>code.</span></h1><p className="hero-copy">Turn screenshots of code into clean, editable source code.</p><Extractor /></section></main>;
}
