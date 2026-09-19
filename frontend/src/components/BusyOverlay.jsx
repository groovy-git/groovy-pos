import { useEffect, useState, useSyncExternalStore } from "react";
import { busyMessage, isBusy, subscribeBusy, takeOwnBack } from "../lib/busy";
import { Spinner } from "./ui";

// Blocks taps, typing, the phone's Back button and scanner input while runBusy() is in progress.
// The spinner card appears only after a moment, so quick saves don't flicker.
export default function BusyOverlay() {
  const busy = useSyncExternalStore(subscribeBusy, isBusy);
  const msg = useSyncExternalStore(subscribeBusy, busyMessage);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!busy) {
      setShown(false);
      return;
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const t = setTimeout(() => setShown(true), 250);
    const block = (e) => {
      if (!isBusy()) return; // finished already: the app's own next step (e.g. going back) must pass
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
    };
    // Back button: undo the step back and keep the router / sheets from seeing it
    const onPop = (e) => {
      if (takeOwnBack() || !isBusy()) return; // the app's own step back (a sheet closing) passes
      e.stopImmediatePropagation();
      window.history.go(1);
    };
    window.addEventListener("keydown", block, true);
    window.addEventListener("popstate", onPop, true);
    window.addEventListener("hashchange", block, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", block, true);
      window.removeEventListener("popstate", onPop, true);
      window.removeEventListener("hashchange", block, true);
    };
  }, [busy]);

  if (!busy) return null;
  return (
    <div className={"busy-overlay" + (shown ? " show" : "")} role="alert" aria-busy="true" aria-live="assertive" onClickCapture={(e) => e.stopPropagation()}>
      {shown && (
        <div className="busy-card">
          <Spinner />
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}
