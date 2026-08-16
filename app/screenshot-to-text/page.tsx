import Extractor from "@/components/Extractor";
export const metadata = {
  title: "Screenshot to Text — Free Online OCR | SnapExtract",
  description: "Extract editable text from a screenshot or image instantly."
};
export default function ScreenshotToText() {
  return <main><header className="nav"><a className="brand" href="/"><span className="brand-mark">S</span><span>SnapExtract</span></a></header><section className="hero"><div className="eyebrow">FREE ONLINE OCR</div><h1>Screenshot to <span>text.</span></h1><p className="hero-copy">Upload an image and turn it into clean, editable text.</p><Extractor /></section></main>;
}
