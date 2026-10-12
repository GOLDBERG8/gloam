"use client";

import { useEffect, useState } from "react";
import { getConsent, setConsent, type ConsentValue } from "@/lib/consent";

export function CookiePreferences() {
  const [current, setCurrent] = useState<ConsentValue | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCurrent(getConsent());
  }, []);

  const save = (value: ConsentValue) => {
    setConsent(value);
    setCurrent(value);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="gl-card p-5">
      <p className="text-sm text-mute">
        Current choice:{" "}
        <span className="text-foreground">
          {current === "all"
            ? "Accept all (our visit count on)"
            : current === "essential"
              ? "Essential only"
              : "Not set (works as Essential only)"}
        </span>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save("essential")}
          className="btn btn-ghost btn-sm"
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => save("all")}
          className="btn btn-ink btn-sm"
        >
          Accept all
        </button>
      </div>
      {saved && (
        <p className="mt-3 text-sm text-sealed" role="status">
          Preferences saved.
        </p>
      )}
    </div>
  );
}
