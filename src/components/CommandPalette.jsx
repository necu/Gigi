import { useMemo, useRef, useState } from "react";
import useFocusTrap from "../utils/useFocusTrap";
import { SearchIcon } from "./Icons";

function buildCommands({ onNavigate, onSearch, onShowShortcuts, onClose }) {
  const go = (page) => () => {
    onNavigate?.(page);
    onClose?.();
  };

  return [
    {
      id: "home",
      label: "Go to Home",
      hint: "Home",
      keywords: "home start discover",
      run: go("home"),
    },
    {
      id: "library",
      label: "Go to Library & History",
      hint: "Library",
      keywords: "library history saved watchlist",
      run: go("history"),
    },
    {
      id: "playlists",
      label: "Go to Playlists",
      hint: "Playlists",
      keywords: "playlist mood collection",
      run: go("playlists"),
    },
    {
      id: "downloads",
      label: "Go to Downloads",
      hint: "Downloads",
      keywords: "download offline files",
      run: go("downloads"),
    },
    {
      id: "settings",
      label: "Go to Settings",
      hint: "Settings",
      keywords: "settings preferences options",
      run: go("settings"),
    },
    {
      id: "search",
      label: "Search movies, series and people",
      hint: "Ctrl+F",
      keywords: "search find title person",
      run: () => {
        onClose?.();
        onSearch?.();
      },
    },
    {
      id: "shortcuts",
      label: "Show keyboard shortcuts",
      hint: "?",
      keywords: "help keys keyboard shortcuts",
      run: () => {
        onClose?.();
        onShowShortcuts?.();
      },
    },
  ];
}

export default function CommandPalette({
  onClose,
  onNavigate,
  onSearch,
  onShowShortcuts,
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);

  useFocusTrap(dialogRef, { onEscape: onClose });

  const commands = useMemo(
    () => buildCommands({ onNavigate, onSearch, onShowShortcuts, onClose }),
    [onNavigate, onSearch, onShowShortcuts, onClose],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.hint} ${command.keywords}`
        .toLowerCase()
        .includes(q),
    );
  }, [commands, query]);

  const activeIndex = Math.min(highlight, Math.max(0, filtered.length - 1));

  const run = (command) => {
    if (command) command.run();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) =>
        filtered.length ? (Math.min(current, filtered.length - 1) + 1) % filtered.length : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) =>
        filtered.length
          ? (Math.max(current, 0) - 1 + filtered.length) % filtered.length
          : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(filtered[activeIndex]);
    }
  };

  return (
    <div
      className="command-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <div className="command-palette" ref={dialogRef} tabIndex={-1}>
        <div className="command-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            className="command-input"
            data-autofocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Go to a page, search, or run a command…"
            aria-label="Command palette"
            aria-controls="command-list"
            aria-activedescendant={
              filtered[activeIndex] ? `command-${filtered[activeIndex].id}` : undefined
            }
          />
          <kbd className="command-kbd">Esc</kbd>
        </div>

        <div className="command-list" id="command-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="command-empty">No commands match “{query}”.</div>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                id={`command-${command.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`command-item${index === activeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                <span className="command-hint">{command.hint}</span>
              </button>
            ))
          )}
        </div>

        <div className="command-footer">
          <span>↑↓ to navigate</span>
          <span>Enter to select</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
