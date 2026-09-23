import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Show what this screen showed last time, then quietly replace it.
 *
 * Every screen used to clear itself and put up a skeleton while it waited, which on a weak connection
 * meant staring at grey boxes for several seconds on every tab change — even when the answer turned
 * out to be identical. The last answer is kept per screen and per filter, so the screen paints at
 * once and the fresh figures drop in when they arrive.
 *
 * Kept in sessionStorage: it lasts as long as the app is open, is cleared on logout with everything
 * else, and never outlives the tab. If storage is unavailable (private mode) the screen simply
 * behaves as it did before.
 */
const read = (k) => {
  try {
    const v = sessionStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

const write = (k, v) => {
  try {
    sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* full or blocked — the screen just won't have a head start next time */
  }
};

export function useCachedFetch(key, run, deps, onError) {
  const [data, setData] = useState(() => read(key));
  const [loading, setLoading] = useState(true);
  const runRef = useRef(run);
  runRef.current = run;
  const errRef = useRef(onError);
  errRef.current = onError;
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setData(read(key)); // whatever this filter showed last time, straight away
    setLoading(true);
    runRef.current()
      .then((d) => {
        if (!live) return;
        setData(d);
        write(key, d);
      })
      .catch((e) => {
        if (!live) return;
        if (errRef.current) errRef.current(e);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [key, nonce, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, reload };
}
