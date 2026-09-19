// App-wide "please wait": while an action that changes or leaves the screen is running (logout, branch
// switch, saving a sale / product / stock …) the whole screen is blocked so nothing else can be tapped,
// typed, scanned or navigated. Used through runBusy(); BusyOverlay draws it.
let active = 0;
let message = "";
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());

export const isBusy = () => active > 0;
export const busyMessage = () => message;
export function subscribeBusy(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Back steps the app makes itself (closing a sheet, returning after a save) must not be blocked —
// only the person's own Back button is. Call this right before such a history.back().
let ownBackUntil = 0; // a mark expires quickly, so it can never excuse a later Back-button press
export function markOwnBack() {
  ownBackUntil = Date.now() + 1000;
}
export function takeOwnBack() {
  if (Date.now() > ownBackUntil) return false;
  ownBackUntil = 0;
  return true;
}

export async function runBusy(msg, fn) {
  active++;
  message = msg || "Please wait…";
  notify();
  try {
    return await fn();
  } finally {
    active--;
    notify();
  }
}
