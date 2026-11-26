import { DownloadIcon } from "./Icons";
import { translate as tr } from "../utils/i18n";

export default function CloseConfirmModal({ count, onConfirm, onCancel }) {
  return (
    <div className="close-confirm-overlay">
      <div className="close-confirm-modal">
        <div className="close-confirm-icon-wrap">
          <div className="close-confirm-icon-ring">
            <DownloadIcon />
          </div>
        </div>

        <div className="close-confirm-title">
          Download{count > 1 ? "s" : ""} in Progress
        </div>

        <div className="close-confirm-body">
          <span className="close-confirm-count">
            {count} active download{count > 1 ? "s" : ""}
          </span>{" "}
          will be cancelled and incomplete files will be deleted.
        </div>

        <div className="close-confirm-actions">
          <button className="btn close-confirm-btn-cancel" onClick={onCancel}>
            {tr("closeConfirm.keepDownloading")}
          </button>
          <button className="btn close-confirm-btn-confirm" onClick={onConfirm}>
            {tr("closeConfirm.cancelAndCloseApp")}
          </button>
        </div>
      </div>
    </div>
  );
}
