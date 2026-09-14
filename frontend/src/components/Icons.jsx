// Small inline stroke icons — no icon-font dependency, they inherit currentColor
// and the stroke width set by their container (see .nav-ico / .kpi-ico in
// styles.css). Keep them simple and consistent (1.9 stroke, round caps).

const P = (props) => <path {...props} />;

export const IconOverview = () => (
  <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const IconFleet = () => (
  <svg viewBox="0 0 24 24"><path d="M3 13h11V6H3z" /><path d="M14 9h3l4 3v1h-7z" /><circle cx="6.5" cy="17" r="1.8" /><circle cx="17.5" cy="17" r="1.8" /></svg>
);
export const IconTrends = () => (
  <svg viewBox="0 0 24 24"><path d="M4 15l4-5 4 3 6-8" /><path d="M14 5h6v6" /></svg>
);
export const IconLeaf = () => (
  <svg viewBox="0 0 24 24"><path d="M20 4C10 4 4 10 4 20c8 0 16-4 16-16z" /><path d="M4 20c4-8 8-10 12-12" /></svg>
);
export const IconHealth = () => (
  <svg viewBox="0 0 24 24"><path d="M3 12h4l2 5 4-12 2 7h6" /></svg>
);
export const IconAlerts = () => (
  <svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" /></svg>
);
export const IconCost = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.6-1-1.7-1.5-2.8-1.5C10 8 9 9 9 10.2c0 2.6 5.5 1.4 5.5 4 0 1.2-1.2 2.3-2.8 2.3-1.2 0-2.3-.6-2.9-1.6" /><path d="M12 6.5v11" /></svg>
);
export const IconReport = () => (
  <svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 13h6M9 17h6" /></svg>
);
export const IconTank = () => (
  <svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="3" /><path d="M6 13c2 1.5 4 1.5 6 0s4-1.5 6 0" /></svg>
);
export const IconClock = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconGauge = () => (
  <svg viewBox="0 0 24 24"><path d="M4 15a8 8 0 0 1 16 0" /><path d="M12 15l4-4" /></svg>
);
export const IconPin = () => (
  <svg viewBox="0 0 24 24"><path d="M12 21c4-4.5 7-7.6 7-11a7 7 0 1 0-14 0c0 3.4 3 6.5 7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
);
export const IconRoute = () => (
  <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.3" /><circle cx="18" cy="18" r="2.3" /><path d="M8 6h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6" /></svg>
);
export const IconDrop = () => (
  <svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>
);
export const IconRecycle = () => (
  <svg viewBox="0 0 24 24"><path d="M7 8l-3 5 3 2" /><path d="M4 13h6l3-5" /><path d="M14 6l3 5-3 2" /><path d="M17 11l3 5h-6" /></svg>
);
export const IconCO2 = () => (
  <svg viewBox="0 0 24 24"><path d="M8 8c-2.5 0-4 1.8-4 4s1.5 4 4 4" /><circle cx="15" cy="12" r="4" /><path d="M20 15v2h-2" /></svg>
);
export const IconBolt = () => (
  <svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></svg>
);
