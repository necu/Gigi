// ── Per-page panel order ─────────────────────────────────────────────────────
// Panels can be rearranged in place. The choice is stored per page so the
// library stays personal without touching the home layout setting.
import { storage } from "./storage";

const STORAGE_KEY = "sectionOrder";

export function loadSectionOrder(page, defaults) {
  const all = storage.get(STORAGE_KEY) || {};
  const saved = Array.isArray(all[page]) ? all[page] : [];
  const known = new Set(defaults);
  const order = saved.filter((id) => known.has(id));
  for (const id of defaults) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

export function saveSectionOrder(page, order) {
  const all = storage.get(STORAGE_KEY) || {};
  all[page] = order;
  storage.set(STORAGE_KEY, all);
}

export function moveSection(order, id, delta) {
  const index = order.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, id);
  return next;
}
