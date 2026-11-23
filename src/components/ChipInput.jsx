import { useState } from "react";

/** Small reusable tag/term editor used by the watchlist and playlist forms. */
export default function ChipInput({
  label,
  placeholder,
  values = [],
  onChange,
  suggestions = [],
}) {
  const [draft, setDraft] = useState("");

  const add = (raw) => {
    const value = (raw || "").trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
  };

  const available = suggestions.filter((item) => !values.includes(item));

  return (
    <div className="watchlist-field">
      <label className="watchlist-label">{label}</label>
      <div className="chip-input">
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              aria-label={`Remove ${value}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            }
            if (event.key === "Backspace" && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
          placeholder={values.length === 0 ? placeholder : ""}
        />
      </div>
      {available.length > 0 && (
        <div className="chip-suggestions">
          {available.slice(0, 8).map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              className="chip-suggestion"
              onClick={() => add(suggestion)}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
