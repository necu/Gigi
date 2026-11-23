import { useRef, useState } from "react";
import { WATCH_STATUSES } from "../utils/watchlist";
import useFocusTrap from "../utils/useFocusTrap";
import ChipInput from "./ChipInput";
import { CloseIcon } from "./Icons";

export default function WatchlistEditModal({
  entry,
  onClose,
  onSave,
  allTags = [],
  allCollections = [],
}) {
  const [status, setStatus] = useState(entry.status);
  const [rating, setRating] = useState(entry.personalRating ?? 0);
  const [tags, setTags] = useState(entry.tags || []);
  const [collections, setCollections] = useState(entry.collections || []);
  const [notes, setNotes] = useState(entry.notes || "");
  const dialogRef = useRef(null);

  useFocusTrap(dialogRef, { onEscape: onClose });

  const handleSave = () => {
    onSave({
      status,
      personalRating: rating > 0 ? rating : null,
      tags,
      collections,
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="download-modal watchlist-edit"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${entry.title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="download-modal-header">
          <span>Edit watchlist entry</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="watchlist-edit-body">
          <div className="watchlist-edit-title">
            {entry.title}
            {entry.year ? <span> · {entry.year}</span> : null}
          </div>

          <div className="watchlist-field">
            <label className="watchlist-label">Status</label>
            <div className="status-picker">
              {WATCH_STATUSES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`status-option${status === option.id ? " active" : ""}`}
                  style={{ "--status-color": option.color }}
                  onClick={() => setStatus(option.id)}
                >
                  <span className="status-dot" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="watchlist-field">
            <label className="watchlist-label">
              Personal rating{" "}
              <span className="watchlist-label-value">
                {rating > 0 ? `${rating}/10` : "not rated"}
              </span>
            </label>
            <div className="rating-row">
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
              />
              {rating > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setRating(0)}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <ChipInput
            label="Tags"
            placeholder="anime, cozy, rewatch…"
            values={tags}
            onChange={setTags}
            suggestions={allTags}
          />

          <ChipInput
            label="Collections"
            placeholder="Weekend, Nolan, Pending…"
            values={collections}
            onChange={setCollections}
            suggestions={allCollections}
          />

          <div className="watchlist-field">
            <label className="watchlist-label">Notes</label>
            <textarea
              className="watchlist-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Why did you save this? What should you remember?"
              rows={4}
            />
          </div>
        </div>

        <div className="watchlist-edit-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
