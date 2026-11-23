import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a dialog and restores it when the dialog closes.
 * The first `[data-autofocus]` element wins over the first focusable element.
 */
export default function useFocusTrap(
  ref,
  { onEscape, active = true } = {},
) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const node = ref.current;
    const previousFocus = document.activeElement;

    const focusable = () =>
      [...node.querySelectorAll(FOCUSABLE)].filter(
        (element) =>
          !element.disabled &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0,
      );

    const focusFirst = () => {
      const preferred = node.querySelector("[data-autofocus]");
      const target = preferred || focusable()[0] || node;
      target?.focus?.({ preventScroll: true });
    };

    const timer = window.setTimeout(focusFirst, 0);

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [active, ref]);
}
