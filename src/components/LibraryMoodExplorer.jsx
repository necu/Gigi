import { useEffect, useMemo, useRef, useState } from "react";
import { buildVibeFacets, VIBE_GROUPS } from "../utils/vibeTags";
import { imgUrl } from "../utils/api";
import { useT } from "../utils/i18n";

const CLOUD_LIMIT_PER_GROUP = 14;

function activeChips(active, facets) {
  return Object.entries(active || {})
    .filter(([, tag]) => tag)
    .map(([groupId, tag]) => {
      const group = VIBE_GROUPS.find((item) => item.id === groupId) ||
        facets.groups.find((item) => item.id === groupId);
      return { groupId, tag, group };
    });
}

function toggleFilter(active, group, tag, count) {
  if (!count && active?.[group.id] !== tag) return active;
  const next = { ...(active || {}) };
  if (next[group.id] === tag) delete next[group.id];
  else next[group.id] = tag;
  return next;
}

function VitalDot({ accent }) {
  return <span className="vibe-dot" style={{ "--vibe-accent": accent }} />;
}

function entryTitle(entry) {
  return entry?.title || entry?.name || "Sin título";
}

function entryYear(entry) {
  const raw = entry?.release_date || entry?.first_air_date || "";
  const match = String(raw).match(/(\d{4})/);
  return match ? match[1] : "";
}

function entryKey(entry) {
  return `${entry?.media_type || "movie"}-${entry?.id}`;
}

function groupLabel(t, group) {
  return group ? t(`vibe.group.${group.id}`) : "";
}

function groupHint(t, group) {
  return group ? t(`vibe.groupHint.${group.id}`) : "";
}

/**
 * Small 3D depth map: category → subcategory → current selection. It gives the
 * cloud a permanent sense of place, even while the bubbles reorder themselves.
 */
function DepthStack({ group, tag, chips, resultCount = 0 }) {
  const t = useT();
  const selection = chips.length
    ? chips.map((chip) => chip.tag).join(" · ")
    : t("vibe.noSelection");
  return (
    <div className="vibe-depth-stack" aria-hidden="true">
      <div className={`vibe-depth-layer${group ? " is-filled" : ""}`}>
        <span>1</span>
        <small>{t("vibe.category")}</small>
        <b>{group ? groupLabel(t, group) : t("vibe.fullCloud")}</b>
      </div>
      <div className={`vibe-depth-layer${tag ? " is-filled" : ""}`}>
        <span>2</span>
        <small>{t("vibe.subcategory")}</small>
        <b>{tag || "—"}</b>
      </div>
      <div className={`vibe-depth-layer${chips.length ? " is-filled" : ""}`}>
        <span>3</span>
        <small>{t("vibe.selection")}</small>
        <b>{selection}</b>
      </div>
      <div className="vibe-depth-layer is-filled">
        <span>4</span>
        <small>{t("vibe.results")}</small>
        <b>
          {resultCount} {t("vibe.titlesLabel")}
        </b>
      </div>
    </div>
  );
}

/**
 * Compact entry point shown above the library grid. It is deliberately
 * glanceable: the full decision space lives in the 3D cloud modal.
 */
export function VibeFilterPanel({
  entries = [],
  active = {},
  onChange,
  onExpand,
  organizing = false,
  progress = null,
  missingCount = 0,
}) {
  const t = useT();
  const facets = useMemo(
    () => buildVibeFacets(entries, active),
    [entries, active],
  );
  const chips = activeChips(active, facets);
  const suggestions = useMemo(() => {
    const output = [];
    for (const group of facets.groups) {
      for (const item of group.tags) {
        if (item.selected || item.count === 0) continue;
        output.push({ ...item, group });
        if (output.length >= 12) return output.sort((a, b) => b.count - a.count);
      }
    }
    return output.sort((a, b) => b.count - a.count);
  }, [facets]);

  return (
    <section className="vibe-panel" aria-labelledby="vibe-panel-title">
      <div className="vibe-panel__glow" aria-hidden="true" />
      <div className="vibe-panel__intro">
        <div className="vibe-panel__eyebrow">
          <span className="vibe-panel__spark">✦</span>
          {t("vibe.eyebrow")}
        </div>
        <h2 className="vibe-panel__title" id="vibe-panel-title">
          {t("vibe.title")}
        </h2>
        <p className="vibe-panel__copy">{t("vibe.copy")}</p>
        <div className="vibe-panel__meta">
          <span>
            <b>{facets.total}</b> {t("vibe.inCloud")}
          </span>
          {chips.length > 0 && (
            <span>
              <b>{chips.length}</b> {t("vibe.filters")} · <b>{facets.total}</b>{" "}
              {t("vibe.matches")}
            </span>
          )}
          {missingCount > 0 && (
            <span className="vibe-panel__tagging">
              {organizing
                ? t("vibe.tagging", {
                    done: progress?.done || 0,
                    total: progress?.total || missingCount,
                  })
                : t("vibe.pending", { n: missingCount })}
            </span>
          )}
        </div>
      </div>

      <div className="vibe-panel__body">
        {chips.length > 0 ? (
          <div className="vibe-panel__selected">
            {chips.map(({ groupId, tag, group }) => (
              <button
                key={`${groupId}-${tag}`}
                type="button"
                className="vibe-selected-chip"
                style={{ "--vibe-accent": group?.accent || "var(--red)" }}
                onClick={() => onChange(toggleFilter(active, group, tag, 1))}
                title={`Quitar ${tag}`}
              >
                <VitalDot accent={group?.accent || "var(--red)"} />
                <span>{tag}</span>
                <span className="vibe-selected-chip__remove">×</span>
              </button>
            ))}
            <button
              type="button"
              className="vibe-panel__clear"
              onClick={() => onChange({})}
            >
              {t("vibe.clear")}
            </button>
          </div>
        ) : (
          <div className="vibe-panel__hint">{t("vibe.startHint")}</div>
        )}

        <div
          className="vibe-panel__suggestions"
          aria-label={t("vibe.suggestions")}
        >
          {suggestions.slice(0, 7).map(({ tag, count, group }) => (
            <button
              key={tag}
              type="button"
              className="vibe-suggestion"
              style={{ "--vibe-accent": group.accent }}
              onClick={() => onChange(toggleFilter(active, group, tag, count))}
            >
              <span>{tag}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="vibe-panel__expand"
          onClick={onExpand}
          disabled={entries.length === 0}
        >
          <span className="vibe-panel__expand-icon">◈</span>
          {t("vibe.open3d")}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </section>
  );
}

/**
 * Full-screen, guided tag cloud. The cards behind the modal are filtered live,
 * so closing it always reveals an already refined result set.
 *
 * The modal has three permanent anchors so the user never loses their place:
 * a breadcrumb, a category/subcategory header over the cloud, and a live list
 * of the library favourites that match the current selection.
 */
export function VibeCloudModal({
  open,
  entries = [],
  active = {},
  onChange,
  onClose,
  onSelect,
}) {
  const t = useT();
  const [viewMode, setViewMode] = useState("cloud");
  const [groupFilter, setGroupFilter] = useState("all");
  const [focusedTag, setFocusedTag] = useState(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef(null);

  const facets = useMemo(
    () => buildVibeFacets(entries, active),
    [entries, active],
  );
  const chips = activeChips(active, facets);
  const currentGroup = useMemo(
    () => VIBE_GROUPS.find((group) => group.id === groupFilter) || null,
    [groupFilter],
  );
  const selectedTag = currentGroup ? active?.[currentGroup.id] : null;
  const activeTags = useMemo(
    () => Object.values(active || {}).filter(Boolean),
    [active],
  );

  // Live favourites: with a selection every tag must match, with only a
  // category open the title must belong to at least one of its subcategories.
  const favorites = useMemo(() => {
    if (!entries.length) return [];
    if (activeTags.length) {
      return entries.filter((entry) =>
        activeTags.every((tag) => (entry.tags || []).includes(tag)),
      );
    }
    if (currentGroup) {
      return entries.filter((entry) =>
        (entry.tags || []).some((tag) => currentGroup.tags.includes(tag)),
      );
    }
    return entries;
  }, [entries, activeTags, currentGroup]);

  const cloudTags = useMemo(() => {
    const groups =
      groupFilter === "all"
        ? facets.groups
        : facets.groups.filter((group) => group.id === groupFilter);
    return groups.flatMap((group) =>
      group.tags
        .slice(0, CLOUD_LIMIT_PER_GROUP)
        .map((item) => ({ ...item, group })),
    );
  }, [facets, groupFilter]);

  const categoryTotals = useMemo(
    () =>
      facets.groups.map((group) => ({
        ...group,
        total: group.tags.reduce((sum, item) => sum + item.count, 0),
      })),
    [facets],
  );

  const nextGroup = useMemo(() => {
    if (!chips.length) return null;
    return (
      facets.groups
        .filter((group) => !active?.[group.id])
        .map((group) => ({
          group,
          total: group.tags.reduce((sum, tag) => sum + tag.count, 0),
        }))
        .sort((a, b) => b.total - a.total)[0]?.group || null
    );
  }, [facets, chips.length, active]);

  const guideTags = useMemo(() => {
    const groups = nextGroup
      ? [facets.groups.find((group) => group.id === nextGroup.id)].filter(Boolean)
      : facets.groups;
    return groups
      .flatMap((group) => group.tags.map((item) => ({ ...item, group })))
      .filter((item) => !item.selected && item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [facets, nextGroup]);

  useEffect(() => {
    if (!open) setFocusedTag(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const onStageMove = (event) => {
    if (viewMode !== "cloud" || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -10, y: px * 14 });
  };

  const selectTag = (group, item) => {
    const next = toggleFilter(active, group, item.tag, item.count);
    onChange(next);
    // Entering a subcategory keeps its category visible, so the hierarchy is
    // always explicit instead of the cloud silently reordering itself. When the
    // tag becomes the active one, the stage also descends to its title list.
    setGroupFilter(group.id);
    setFocusedTag(next[group.id] === item.tag ? item.tag : null);
  };

  const chooseGroup = (id) => {
    setGroupFilter(id);
    setFocusedTag(null);
  };

  const setCategoryPosition = (index, total) => {
    const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
    return {
      "--cat-x": `${50 + Math.cos(angle) * 34}%`,
      "--cat-y": `${50 + Math.sin(angle) * 28}%`,
      "--cat-z": `${Math.sin(angle) * 90}px`,
      "--cat-delay": `${index * 45}ms`,
    };
  };

  const setCloudPosition = (index, total) => {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = total <= 1 ? 0 : 1 - (index / (total - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    return {
      "--vibe-x": `${50 + x * 37}%`,
      "--vibe-y": `${50 + y * 34}%`,
      "--vibe-z": `${z * 100}px`,
      "--vibe-scale": 0.82 + (z + 1) * 0.16,
      "--vibe-depth": 0.45 + (z + 1) * 0.275,
      "--vibe-delay": `${Math.min(index * 16, 260)}ms`,
    };
  };

  const scopeKind = currentGroup ? t("vibe.category") : t("vibe.overview");
  const scopeTitle = currentGroup
    ? groupLabel(t, currentGroup)
    : t("vibe.allDimensions");
  const scopeHint = currentGroup
    ? groupHint(t, currentGroup)
    : t("vibe.pickCategory");

  return (
    <div
      className="vibe-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="vibe-modal">
        <header className="vibe-modal__head">
          <div>
            <div className="vibe-panel__eyebrow">
              <span className="vibe-panel__spark">✦</span>
              {t("vibe.modalEyebrow")}
            </div>
            <h2 className="vibe-modal__title">{t("vibe.modalTitle")}</h2>
            <p className="vibe-modal__sub">{t("vibe.modalSub")}</p>
          </div>
          <div className="vibe-modal__head-actions">
            <button
              type="button"
              className={`vibe-view-toggle${viewMode === "list" ? " active" : ""}`}
              onClick={() =>
                setViewMode((current) => (current === "list" ? "cloud" : "list"))
              }
            >
              {viewMode === "cloud"
                ? `☷ ${t("vibe.list")}`
                : `◈ ${t("vibe.cloud")}`}
            </button>
            <button
              type="button"
              className="vibe-modal__close"
              onClick={onClose}
              aria-label={t("vibe.close")}
            >
              ×
            </button>
          </div>
        </header>

        <div className="vibe-modal__path">
          <nav className="vibe-breadcrumb" aria-label="Ruta de exploración">
            <span className="vibe-breadcrumb__label">{t("vibe.youAreIn")}</span>
            <button
              type="button"
              className={groupFilter === "all" ? "is-current" : ""}
              onClick={() => chooseGroup("all")}
            >
              {t("vibe.fullCloud")}
            </button>
            {currentGroup && (
              <>
                <span className="vibe-breadcrumb__sep">›</span>
                <button
                  type="button"
                  className={!selectedTag ? "is-current" : ""}
                  onClick={() => chooseGroup(currentGroup.id)}
                >
                  {groupLabel(t, currentGroup)}
                </button>
              </>
            )}
            {selectedTag && (
              <>
                <span className="vibe-breadcrumb__sep">›</span>
                <span className="vibe-breadcrumb__current">{selectedTag}</span>
              </>
            )}
          </nav>
          <div className="vibe-modal__path-right">
            {currentGroup && (
              <button
                type="button"
                className="vibe-stage-back"
                onClick={() => chooseGroup("all")}
              >
                ← {t("vibe.backToCloud")}
              </button>
            )}
            <span className="vibe-modal__path-hint">{scopeHint}</span>
          </div>
        </div>

        <div className="vibe-modal__selection">
          <div className="vibe-modal__selected-list">
            {chips.length ? (
              chips.map(({ groupId, tag, group }) => (
                <button
                  key={`${groupId}-${tag}`}
                  type="button"
                  className="vibe-selected-chip"
                  style={{ "--vibe-accent": group?.accent || "var(--red)" }}
                  onClick={() => onChange(toggleFilter(active, group, tag, 1))}
                >
                  <VitalDot accent={group?.accent || "var(--red)"} />
                  <span>{tag}</span>
                  <span className="vibe-selected-chip__remove">×</span>
                </button>
              ))
            ) : (
              <span className="vibe-modal__empty-selection">
                {t("vibe.noSelection")}
              </span>
            )}
          </div>
          <div className="vibe-modal__result">
            <b>{facets.total}</b>
            <span>{t("vibe.titlesLabel")}</span>
          </div>
        </div>

        <div className="vibe-modal__tabs" role="tablist" aria-label="Categorías">
          <button
            type="button"
            role="tab"
            aria-selected={groupFilter === "all"}
            className={`vibe-dimension${groupFilter === "all" ? " active" : ""}`}
            onClick={() => chooseGroup("all")}
          >
            {t("library.all")}
            <span>{categoryTotals.length}</span>
          </button>
          {facets.groups.map((group) => (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={groupFilter === group.id}
              className={`vibe-dimension${groupFilter === group.id ? " active" : ""}`}
              style={{ "--vibe-accent": group.accent }}
              onClick={() => chooseGroup(group.id)}
            >
              {groupLabel(t, group)}
              <span>{group.tags.length}</span>
            </button>
          ))}
        </div>

        <div className="vibe-modal__body">
          <div className="vibe-modal__stage-wrap">
            <div className="vibe-stage-head">
              <div className="vibe-stage-scope">
                <span
                  className="vibe-stage-scope__kind"
                  style={{ "--vibe-accent": currentGroup?.accent || "var(--red)" }}
                >
                  {scopeKind}
                </span>
                <div className="vibe-stage-scope__title">
                  {scopeTitle}
                  {selectedTag && (
                    <span className="vibe-stage-scope__selected">
                      {" "}/ {selectedTag}
                    </span>
                  )}
                </div>
                <div className="vibe-stage-scope__meta">
                  {currentGroup
                    ? t("vibe.subcategories", { n: currentGroup.tags.length })
                    : t("vibe.allCategories", { n: facets.groups.length })}
                  {" · "}
                  <b>{t("vibe.titles", { n: facets.total })}</b> ·{" "}
                  <b>{t("vibe.favorites", { n: favorites.length })}</b>
                </div>
              </div>
              {groupFilter === "all" && (
                <div className="vibe-stage-legend" aria-label="Cambiar categoría">
                  {facets.groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className="vibe-legend"
                      style={{ "--vibe-accent": group.accent }}
                      onClick={() => chooseGroup(group.id)}
                    >
                      <VitalDot accent={group.accent} />
                      {groupLabel(t, group)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="vibe-stage-canvas">
              {focusedTag && selectedTag === focusedTag ? (
                <div className="vibe-tag-results">
                  <div className="vibe-tag-results__head">
                    <button
                      type="button"
                      className="vibe-stage-back"
                      onClick={() => setFocusedTag(null)}
                    >
                      ← {t("vibe.backToSubcategories")}
                    </button>
                    <div className="vibe-tag-results__title">
                      <small>{t("vibe.resultsIn")}</small>
                      <b>{focusedTag}</b>
                    </div>
                    <span className="vibe-tag-results__count">
                      {favorites.length}
                    </span>
                  </div>
                  {favorites.length ? (
                    <div className="vibe-tag-results__grid">
                      {favorites.map((entry) => (
                        <button
                          key={entryKey(entry)}
                          type="button"
                          className="vibe-result-card"
                          onClick={() => onSelect?.(entry)}
                          title={t("vibe.openTitle")}
                        >
                          <span className="vibe-result-card__poster">
                            {entry.poster_path ? (
                              <img
                                src={imgUrl(entry.poster_path, "w185")}
                                alt=""
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <span>{entryTitle(entry).slice(0, 1)}</span>
                            )}
                          </span>
                          <span className="vibe-result-card__copy">
                            <b>{entryTitle(entry)}</b>
                            <small>
                              {entry.media_type === "tv"
                                ? t("carousel.series")
                                : t("carousel.movie")}
                              {entryYear(entry) ? ` · ${entryYear(entry)}` : ""}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="vibe-tag-results__empty">
                      <span>✦</span>
                      <b>{t("vibe.noResults")}</b>
                    </div>
                  )}
                </div>
              ) : cloudTags.length === 0 ? (
                <div className="vibe-cloud-empty">
                  <span>✦</span>
                  <b>
                    {groupFilter === "all"
                      ? t("vibe.emptyTags")
                      : t("vibe.emptyCategory", {
                          name: currentGroup?.label || scopeTitle,
                        })}
                  </b>
                  <p>
                    {groupFilter === "all"
                      ? t("vibe.emptyTagsHint")
                      : t("vibe.emptyCategoryHint")}
                  </p>
                </div>
              ) : viewMode === "cloud" ? (
                <div
                  ref={stageRef}
                  className={`vibe-cloud-stage${dragging ? " is-dragging" : ""}`}
                  style={{
                    "--vibe-scope-accent": currentGroup?.accent || "#e50914",
                  }}
                  onMouseMove={onStageMove}
                  onMouseLeave={() => setTilt({ x: 0, y: 0 })}
                  onPointerDown={() => setDragging(true)}
                  onPointerUp={() => setDragging(false)}
                  onPointerCancel={() => setDragging(false)}
                >
                  <div className="vibe-cloud__orb" aria-hidden="true" />
                  {groupFilter === "all" ? (
                    <div
                      className="vibe-category-orbit"
                      style={{
                        transform: `rotateX(${tilt.x * 0.6}deg) rotateY(${tilt.y * 0.6}deg)`,
                      }}
                    >
                      {categoryTotals.map((group, index) => (
                        <button
                          key={group.id}
                          type="button"
                          className="vibe-category-planet"
                          style={{
                            "--vibe-accent": group.accent,
                            ...setCategoryPosition(index, categoryTotals.length),
                          }}
                          onClick={() => chooseGroup(group.id)}
                          title={groupHint(t, group)}
                        >
                          <VitalDot accent={group.accent} />
                          <b>{groupLabel(t, group)}</b>
                          <span>
                            {group.tags.length} · {group.total}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="vibe-cloud__orbit"
                      style={{
                        transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                      }}
                    >
                      {cloudTags.map((item, index) => (
                        <button
                          key={`${groupFilter}-${item.group.id}-${item.tag}`}
                          type="button"
                          className={`vibe-cloud__tag${item.selected ? " is-selected" : ""}`}
                          style={{
                            "--vibe-accent": item.group.accent,
                            ...setCloudPosition(index, cloudTags.length),
                          }}
                          onClick={() => selectTag(item.group, item)}
                          title={groupHint(t, item.group)}
                        >
                          <span>{item.tag}</span>
                          <b>{item.count}</b>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="vibe-cloud__axis" aria-hidden="true" />
                  <DepthStack
                    group={currentGroup}
                    tag={selectedTag}
                    chips={chips}
                    resultCount={favorites.length}
                  />
                  <div className="vibe-cloud__scope-badge">
                    <span>{scopeKind}</span>
                    <b>{scopeTitle}</b>
                  </div>
                </div>
              ) : (
                <div className="vibe-list-view">
                  {(groupFilter === "all"
                    ? facets.groups
                    : facets.groups.filter((group) => group.id === groupFilter)
                  ).map((group) => (
                    <section className="vibe-list-group" key={group.id}>
                      <div className="vibe-list-group__head">
                        <VitalDot accent={group.accent} />
                        <b>{groupLabel(t, group)}</b>
                        <span>{groupHint(t, group)}</span>
                      </div>
                      <div className="vibe-list-group__tags">
                        {group.tags.map((item) => (
                          <button
                            key={item.tag}
                            type="button"
                            className={`vibe-list-tag${item.selected ? " is-selected" : ""}`}
                            style={{ "--vibe-accent": group.accent }}
                            onClick={() => selectTag(group, item)}
                          >
                            {item.tag}
                            <span>{item.count}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="vibe-modal__guide">
            <section className="vibe-favorites" aria-live="polite">
              <div className="vibe-favorites__head">
                <span className="vibe-guide__kicker">{t("vibe.live")}</span>
                <span className="vibe-favorites__count">
                  <b>{favorites.length}</b> / {entries.length}
                </span>
              </div>
              <div className="vibe-favorites__title">
                {activeTags.length
                  ? t("vibe.liveInSelection")
                  : currentGroup
                    ? t("vibe.liveInCategory", {
                        name: groupLabel(t, currentGroup),
                      })
                    : t("vibe.allFavorites")}
              </div>
              <p className="vibe-favorites__copy">
                {activeTags.length
                  ? t("vibe.liveAllCopy")
                  : currentGroup
                    ? t("vibe.liveCategoryCopy")
                    : t("vibe.liveNoneCopy")}
              </p>
              <div className="vibe-favorites__list">
                {favorites.slice(0, 12).map((entry) => (
                  <button
                    type="button"
                    className="vibe-favorite vibe-favorite--button"
                    key={entryKey(entry)}
                    onClick={() => onSelect?.(entry)}
                    title={t("vibe.openTitle")}
                  >
                    <span className="vibe-favorite__poster">
                      {entry.poster_path ? (
                        <img
                          src={imgUrl(entry.poster_path, "w92")}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span>{entryTitle(entry).slice(0, 1)}</span>
                      )}
                    </span>
                    <span className="vibe-favorite__info">
                      <b>{entryTitle(entry)}</b>
                      <span>
                        {entry.media_type === "tv"
                          ? t("carousel.series")
                          : t("carousel.movie")}
                        {entryYear(entry) ? ` · ${entryYear(entry)}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
                {favorites.length === 0 && (
                  <div className="vibe-favorites__empty">
                    {t("vibe.noFavorites")}
                  </div>
                )}
              </div>
            </section>

            <section className="vibe-guide-next">
              <div className="vibe-guide__kicker">
                {chips.length ? t("vibe.nextHint") : t("vibe.howItWorks")}
              </div>
              {chips.length && nextGroup ? (
                <>
                  <div className="vibe-guide__title">
                    {t("vibe.refineWith", {
                      name: groupLabel(t, nextGroup).toLowerCase(),
                    })}
                  </div>
                  <p className="vibe-guide__copy">{nextGroup.hint}</p>
                  <div className="vibe-guide__tags">
                    {guideTags.map((item) => (
                      <button
                        key={item.tag}
                        type="button"
                        className="vibe-guide-tag"
                        style={{ "--vibe-accent": item.group.accent }}
                        onClick={() => selectTag(item.group, item)}
                      >
                        <span>{item.tag}</span>
                        <b>{item.count}</b>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="vibe-guide__title">{t("vibe.guideTitle")}</div>
                  <p className="vibe-guide__copy">{t("vibe.guideCopy")}</p>
                  <div className="vibe-guide__legend">
                    {VIBE_GROUPS.map((group) => (
                      <span key={group.id}>
                        <VitalDot accent={group.accent} />
                        {groupLabel(t, group)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            <div className="vibe-guide__tip">
              <span>{t("vibe.tip")}</span>
              {t("vibe.tipCopy")}
            </div>
          </aside>
        </div>

        <footer className="vibe-modal__footer">
          <div className="vibe-modal__footer-copy">
            {t("vibe.resultsReady", { n: facets.total })}
            {chips.length > 0 ? t("vibe.savedAsPreferred") : ""}
          </div>
          <div className="vibe-modal__footer-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onChange({})}
              disabled={!chips.length}
            >
              {t("vibe.reset")}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t("vibe.showResults")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default VibeFilterPanel;
