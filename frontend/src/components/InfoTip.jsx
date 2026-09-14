import { useEffect, useRef, useState } from "react";

// Info-icon disclosure: reveals `text` on click via a native <details>/
// <summary> (no JS needed for the open/close toggle itself). Shared by any
// panel header or card that wants an (i) note instead of always-visible
// caption text (see KpiStrip.jsx, PumpUtilisation.jsx).
//
// `name="info-tip"` makes every InfoTip on the page one native exclusive
// group (Chrome/Edge, Safari 16.4+, Firefox 121+) - opening one closes any
// other automatically, so two can never overlap. Closes on blur (focus
// leaving it entirely) and on scroll, since neither would otherwise dismiss
// it - left open, it would just sit there showing a stale message.
//
// The popover's extend-direction is measured and flipped after opening if it
// would overflow the viewport: the same control can end up in different
// columns/positions at different breakpoints, so a fixed direction isn't
// safe - it extends right by default, flipping to extend left if that
// overflows.
//
// Closes on outside click and on scroll (same "click outside" pattern
// VehiclePicker.jsx uses), NOT on blur. It used to close on blur, but
// <summary> is the only focusable element in the pair - clicking (or
// drag-selecting) the plain text in the popover isn't focusable, so focus
// lands on nothing and `relatedTarget` is null; `contains(null)` is always
// false, so blur fired on every click INSIDE the tip too, closing it out
// from under a click. Worse, synchronously setting `.open = false` from
// inside that blur handler, on a `name="info-tip"` details element that's
// also part of the browser's own native cross-element exclusive-group
// bookkeeping, crashed the tab outright in some browsers (STATUS_BREAKPOINT,
// Joe 2026-09-13) - an edge case in that still-new native feature. The
// outside-click listener sidesteps both: it only ever reads `.open`/closes
// from a plain event handler, never as a side effect of blur.
export default function InfoTip({ label, text }) {
  const detailsRef = useRef(null);
  const popRef = useRef(null);
  const [align, setAlign] = useState("left"); // "left" = pop's left edge at the icon (extends right)

  const onToggle = (e) => {
    if (!e.currentTarget.open) { setAlign("left"); return; }
    requestAnimationFrame(() => {
      const rect = popRef.current?.getBoundingClientRect();
      if (rect && rect.right > window.innerWidth - 8) setAlign("right");
    });
  };

  useEffect(() => {
    const close = () => { if (detailsRef.current) detailsRef.current.open = false; };
    const onDocMouseDown = (e) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target)) close();
    };
    // Capture phase so this catches scrolling on any scrollable ancestor, not
    // just the window - scroll doesn't bubble, only capture propagates it.
    const onScroll = () => { if (detailsRef.current?.open) close(); };
    document.addEventListener("mousedown", onDocMouseDown, { capture: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);

  return (
    <details className="info-tip" name="info-tip" ref={detailsRef} onToggle={onToggle}>
      <summary aria-label={`About ${label}`}>ⓘ</summary>
      <div ref={popRef} className={`info-tip-pop align-${align}`}>{text}</div>
    </details>
  );
}
