import { useT } from "../utils/i18n";

/**
 * Minimal wrapper that lets the user move a whole panel up or down. The two
 * arrow buttons only appear on hover/focus so panels keep their clean look.
 */
export default function SectionFrame({
  id,
  index = 0,
  count = 1,
  onMove,
  className = "",
  order,
  children,
}) {
  const t = useT();
  return (
    <div
      className={`section-frame ${className}`.trim()}
      data-section={id}
      style={order == null ? undefined : { order }}
    >
      <div className="section-frame__movers">
        <button
          type="button"
          className="section-frame__move"
          disabled={index <= 0}
          onClick={() => onMove?.(id, -1)}
          title={t("common.moveUp")}
          aria-label={t("common.moveUp")}
        >
          ↑
        </button>
        <button
          type="button"
          className="section-frame__move"
          disabled={index >= count - 1}
          onClick={() => onMove?.(id, 1)}
          title={t("common.moveDown")}
          aria-label={t("common.moveDown")}
        >
          ↓
        </button>
      </div>
      {children}
    </div>
  );
}
