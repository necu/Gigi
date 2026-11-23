import { useEffect, useMemo, useRef, useState } from "react";
import { discoverSagas } from "../utils/sagas";
import { imgUrl } from "../utils/api";
import { CloseIcon } from "./Icons";
import useFocusTrap from "../utils/useFocusTrap";

const KIND_LABELS = {
  official: "Official collection",
  universe: "Shared universe",
  deep: "Possible saga",
};

const STAGE_LABELS = {
  official: "reading the official collection",
  universe: "checking shared universes",
  deep: "scanning connections",
  validate: "validating candidates",
};

export default function SagaModal({
  type = "movie",
  item,
  details,
  apiKey,
  isSaved,
  onClose,
  onAddSaga,
  onOpenPlaylist,
}) {
  const [sagas, setSagas] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deepLoading, setDeepLoading] = useState(false);
  const [stage, setStage] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);
  const dialogRef = useRef(null);

  const title =
    details?.title ||
    details?.name ||
    item?.title ||
    item?.name ||
    "This title";

  async function run(deep) {
    const requestId = ++requestRef.current;
    if (deep) setDeepLoading(true);
    else setLoading(true);
    setError(null);
    setStage(deep ? "deep" : "official");

    try {
      const result = await discoverSagas({
        type,
        id: item?.id,
        apiKey,
        details,
        deep,
        onProgress: (progress) => {
          if (requestId === requestRef.current) setStage(progress.stage);
        },
      });
      if (requestId !== requestRef.current) return;

      setSagas((previous) => {
        const merged = [...previous];
        for (const saga of result.sagas || []) {
          if (
            !merged.some(
              (entry) =>
                entry.id === saga.id || entry.name === saga.name,
            )
          ) {
            merged.push(saga);
          }
        }
        return merged.sort((a, b) => b.confidence - a.confidence);
      });
      setSelectedId((previous) => previous || result.sagas?.[0]?.id || null);
      if (result.sagas?.length === 0 && deep) {
        setError("No additional saga connections were found.");
      }
    } catch {
      if (requestId === requestRef.current) {
        setError("Could not read saga data right now.");
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setDeepLoading(false);
        setStage(null);
      }
    }
  }

  useFocusTrap(dialogRef, { onEscape: onClose });

  useEffect(() => {
    setSagas([]);
    setSelectedId(null);
    run(false);
    return () => {
      requestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, apiKey]);

  const selected = useMemo(
    () => sagas.find((saga) => saga.id === selectedId) || sagas[0] || null,
    [sagas, selectedId],
  );

  const savedCount = selected
    ? selected.parts.filter((part) => isSaved?.(part)).length
    : 0;

  const handleAdd = async (openPlaylist) => {
    if (!selected || adding) return;
    setAdding(true);
    try {
      await onAddSaga?.(selected.parts, {
        saga: {
          name: selected.name,
          collections: selected.collectionNames,
          kind: selected.kind,
        },
      });
      if (openPlaylist) onOpenPlaylist?.(selected.name);
      onClose?.();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Sagas for ${title}`}
      onClick={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <div
        ref={dialogRef}
        className="saga-modal"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="saga-modal__header">
          <div>
            <div className="saga-modal__title">Build a saga</div>
            <div className="saga-modal__sub">
              {title} can be part of a bigger story. Save every part at once and
              the library keeps them together as a playlist.
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => onClose?.()}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="saga-modal__body">
          {loading && (
            <div className="saga-options">
              {Array.from({ length: 2 }).map((_, index) => (
                <div className="saga-option saga-option--skeleton" key={index}>
                  <div className="saga-skeleton-line" />
                  <div className="saga-skeleton-line saga-skeleton-line--short" />
                </div>
              ))}
            </div>
          )}

          {!loading && sagas.length === 0 && (
            <div className="saga-empty">
              <div className="saga-empty__title">
                No official collection for {title}
              </div>
              <p>
                That does not mean there is no saga. Scan the connections —
                shared cast, directors, music, cinematography, themes and
                studios — to surface the franchises TMDB keeps apart, like Alien
                and Predator.
              </p>
            </div>
          )}

          {sagas.length > 0 && (
            <div className="saga-options">
              {sagas.map((saga) => {
                const active = selected?.id === saga.id;
                return (
                  <button
                    key={saga.id}
                    type="button"
                    className={`saga-option${active ? " active" : ""}`}
                    onClick={() => setSelectedId(saga.id)}
                  >
                    <div className="saga-option__main">
                      <div className="saga-option__name">
                        {saga.name}
                        <span className={`saga-option__kind is-${saga.kind}`}>
                          {KIND_LABELS[saga.kind] || "Saga"}
                        </span>
                      </div>
                      <div className="saga-option__meta">
                        {saga.parts.length} titles ·{" "}
                        {Math.round(saga.confidence * 100)}% confidence
                      </div>
                      {saga.note && (
                        <div className="saga-option__note">{saga.note}</div>
                      )}
                      <div className="saga-reasons">
                        {(saga.reasons || []).slice(0, 4).map((reason, index) => (
                          <span
                            className="saga-reason"
                            key={`${reason.label}-${index}`}
                          >
                            {reason.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span
                      className={`saga-option__radio${active ? " checked" : ""}`}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div className="saga-preview">
              <div className="saga-preview__head">
                <span>{selected.parts.length} parts, in release order</span>
                {savedCount > 0 && (
                  <span>{savedCount} already in your library</span>
                )}
              </div>
              <div className="saga-parts">
                {selected.parts.map((part) => {
                  const saved = !!isSaved?.(part);
                  return (
                    <div
                      key={`${part.media_type}_${part.id}`}
                      className={`saga-part${saved ? " is-saved" : ""}${
                        part.id === item?.id ? " is-current" : ""
                      }`}
                    >
                      {part.poster_path ? (
                        <img
                          src={imgUrl(part.poster_path, "w185")}
                          alt={part.title || part.name}
                          loading="lazy"
                        />
                      ) : (
                        <span className="saga-part__placeholder">🎞</span>
                      )}
                      <div className="saga-part__label" title={part.title || part.name}>
                        {part.title || part.name}
                      </div>
                      <div className="saga-part__year">
                        {(part.release_date || "").slice(0, 4)}
                      </div>
                      {saved && <span className="saga-part__check">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <div className="saga-error">{error}</div>}
        </div>

        <div className="saga-modal__footer">
          <button
            className="btn btn-ghost"
            onClick={() => run(true)}
            disabled={loading || deepLoading}
            title="Look for collections that share cast, crew, music, photography and themes"
          >
            {deepLoading
              ? `Scanning ${STAGE_LABELS[stage] || "connections"}…`
              : "Scan for more"}
          </button>
          <div className="saga-modal__spacer" />
          <button className="btn btn-ghost" onClick={() => onClose?.()}>
            Cancel
          </button>
          <button
            className="btn btn-secondary"
            disabled={!selected || adding}
            onClick={() => handleAdd(true)}
          >
            Add &amp; open playlist
          </button>
          <button
            className="btn btn-primary"
            disabled={!selected || adding}
            onClick={() => handleAdd(false)}
          >
            {adding
              ? "Adding…"
              : selected
                ? `Add ${selected.parts.length} to library`
                : "Add saga"}
          </button>
        </div>
      </div>
    </div>
  );
}
