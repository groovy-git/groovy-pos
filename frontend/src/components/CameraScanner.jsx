import { useEffect, useRef, useState } from "react";
import { X, Zap, ZapOff, Check, AlertTriangle, Keyboard } from "lucide-react";
import { useBackClose } from "../hooks/useBackClose";
import { beepOk, beepError } from "../lib/feedback";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "itf"];
let detectorPromise = null;

// Native BarcodeDetector on Android Chrome; zxing-wasm polyfill (bundled locally) on iOS & others.
async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const f = FORMATS.filter((x) => supported.includes(x));
          if (f.length) return new window.BarcodeDetector({ formats: f });
        } catch {
          /* fall through to polyfill */
        }
      }
      const [{ BarcodeDetector, setZXingModuleOverrides }, wasm] = await Promise.all([
        import("barcode-detector/pure"),
        import("zxing-wasm/reader/zxing_reader.wasm?url"),
      ]);
      setZXingModuleOverrides({ locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasm.default : prefix + path) });
      return new BarcodeDetector({ formats: FORMATS });
    })();
  }
  return detectorPromise;
}

/**
 * Full-screen continuous camera scanner.
 * onCode(code) → {ok, label} shown in the result chip. Returns falsy to keep silent.
 * The same code is not counted again while it stays in view; move it away (~1 s) and
 * scan again to add another.
 */
export default function CameraScanner({ open, onClose, onCode, title = "Scan barcode", continuous = true }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [hit, setHit] = useState(null);
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [flash, setFlash] = useState(0);
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const cbRef = useRef(onCode);
  cbRef.current = onCode;
  useBackClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    let timer = null;
    const seen = { code: "", at: 0 };
    setError("");
    setHit(null);

    const handle = (code) => {
      const res = cbRef.current(code);
      if (!res) return;
      if (res.ok) beepOk();
      else beepError();
      setHit({ ...res, code, t: Date.now() });
      setFlash((f) => f + 1);
      if (!continuous && res.ok) setTimeout(onClose, 250);
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        setTorchOk(!!caps.torch);
        const detector = await getDetector();
        const tick = async () => {
          if (stop) return;
          try {
            if (v.readyState >= 2) {
              const codes = await detector.detect(v);
              const now = Date.now();
              if (codes.length) {
                const code = codes[0].rawValue.trim();
                // holding the same box in view never re-counts; it must leave view ~1 s first
                if (code && !(code === seen.code && now - seen.at < 1000)) handle(code);
                seen.code = code;
                seen.at = now;
              }
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 120);
        };
        tick();
      } catch (e) {
        const msg =
          e && e.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access for this app in your phone settings."
            : e && e.name === "NotFoundError"
              ? "No camera found on this device."
              : "Could not start the camera. " + ((e && e.message) || "");
        setError(msg);
      }
    })();

    return () => {
      stop = true;
      clearTimeout(timer);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setTorch(false);
    };
  }, [open, continuous]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    const track = streamRef.current && streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch {
      setTorchOk(false);
    }
  };

  const submitManual = (e) => {
    e.preventDefault();
    const c = manual.trim();
    if (!c) return;
    const res = cbRef.current(c);
    if (res) {
      res.ok ? beepOk() : beepError();
      setHit({ ...res, code: c, t: Date.now() });
    }
    setManual("");
  };

  if (!open) return null;
  return (
    <div className="scanner" role="dialog" aria-label={title}>
      <video ref={videoRef} playsInline muted />
      <div key={flash} className={"frame" + (hit && hit.ok ? " flash-ok" : "")} />
      <div className="top">
        <button className="icon-btn" onClick={onClose} aria-label="Close scanner">
          <X />
        </button>
        <div className="bold">{title}</div>
        {torchOk ? (
          <button className="icon-btn" onClick={toggleTorch} aria-label="Torch">
            {torch ? <ZapOff /> : <Zap />}
          </button>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </div>
      <div className="bottom">
        {error && (
          <div className="hit err">
            <AlertTriangle size={20} /> <span>{error}</span>
          </div>
        )}
        {hit && (
          <div key={hit.t} className={"hit" + (hit.ok ? "" : " err")}>
            {hit.ok ? <Check size={22} color="#2E7D32" /> : <AlertTriangle size={20} />}
            <div className="grow">
              <div className="bold ellipsis">{hit.label}</div>
              <div className="tiny" style={{ opacity: 0.7 }}>{hit.code}</div>
            </div>
          </div>
        )}
        {showManual ? (
          <form onSubmit={submitManual} className="row">
            <input
              className="input grow"
              autoFocus
              inputMode="numeric"
              placeholder="Type barcode"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              data-scan-ignore
            />
            <button className="btn">Add</button>
          </form>
        ) : (
          <div className="row between">
            <button className="btn secondary small" onClick={() => setShowManual(true)}>
              <Keyboard size={16} /> Type code
            </button>
            <button className="btn big" onClick={onClose}>
              Done
            </button>
          </div>
        )}
        <div className="tiny center" style={{ color: "#ddd" }}>
          Point at the barcode. To add one more of the same item, move it away and scan again.
        </div>
      </div>
    </div>
  );
}
