import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Analytics } from "@vercel/analytics/react";
import { getVehicles, getLastKnown, getCustomer } from "./api.js";
import { fmtDMY, fmtDMYTime } from "./dates.js";
import OverviewPage from "./pages/OverviewPage.jsx";
import FleetPage from "./pages/FleetPage.jsx";
import TrendsPage from "./pages/TrendsPage.jsx";
import SustainabilityPage from "./pages/SustainabilityPage.jsx";
import HealthPage from "./pages/HealthPage.jsx";
import AlertsPage from "./pages/AlertsPage.jsx";
import CostingPage from "./pages/CostingPage.jsx";
import RoutesPage from "./pages/RoutesPage.jsx";
import PumpsPage from "./pages/PumpsPage.jsx";
import ReportDialog from "./components/ReportDialog.jsx";
import VehiclePicker from "./components/VehiclePicker.jsx";
import LanguageToggle from "./components/LanguageToggle.jsx";
import {
  IconOverview, IconFleet, IconTrends, IconLeaf, IconHealth, IconAlerts,
  IconCost, IconReport, IconRoute, IconGauge,
} from "./components/Icons.jsx";

// Sidebar navigation — the primary way around the platform. "Overview" and
// "Fleet" lead (single vehicle vs the whole fleet); the analytical pages follow.
// label/title/crumb are i18n keys (nav.* in the locale files), not display
// text - resolved via t() at render time so the same array works in any
// language.
const NAV = [
  { id: "dashboard", labelKey: "nav.overview.label", titleKey: "nav.overview.title", Icon: IconOverview },
  { id: "fleet", labelKey: "nav.fleet.label", titleKey: "nav.fleet.title", Icon: IconFleet, crumbKey: "nav.fleet.crumb" },
  { id: "trends", labelKey: "nav.trends.label", titleKey: "nav.trends.title", Icon: IconTrends },
  { id: "sustainability", labelKey: "nav.sustainability.label", titleKey: "nav.sustainability.title", Icon: IconLeaf },
  { id: "health", labelKey: "nav.health.label", titleKey: "nav.health.title", Icon: IconHealth },
  { id: "alerts", labelKey: "nav.alerts.label", titleKey: "nav.alerts.title", Icon: IconAlerts },
  { id: "pumps", labelKey: "nav.pumps.label", titleKey: "nav.pumps.title", Icon: IconGauge },
  // Renamed from "Weather" (Joe, 2026-09-11) - a standalone weather tab was
  // hard to justify; weather now shows only as a per-entry reference on the
  // new (pending-approval) Work Locations log - see RoutesPage.jsx.
  { id: "routes", labelKey: "nav.routes.label", titleKey: "nav.routes.title", Icon: IconRoute },
  // Re-enabled 2026-09-12, but test-only: the backend still isn't verified
  // against real data for Warrior 75 (fuel/PTO tag widening done, but
  // unconfirmed against the live trial vehicle), and the quote maths hasn't
  // been reviewed for customer use yet either. Filtered out of the sidebar
  // below unless the selected vehicle is the WarriorSimulator test fixture
  // (source === "trial_demo") - same gating AlertsPage's test-only Sensor
  // Health block already uses.
  { id: "costing", labelKey: "nav.costing.label", titleKey: "nav.costing.title", Icon: IconCost },
];

// TEMPORARY (Joe, 2026-09-14): hidden pending further testing - not removed,
// just gated. Flip back to `true` once that's done.
const SHOW_GENERATE_REPORT = false;

// Spec item 1 (Status indicator): online/offline from the newest reading
// across every parameter, compared to now. This threshold is the "how stale
// is too stale" call the spec leaves to us - 15 min covers a couple of
// missed 60s sync ticks without flapping on a single delayed push.
const OFFLINE_THRESHOLD_MIN = 15;

// Remembers the last vehicle actively picked (see chooseVehicle below),
// across reloads - localStorage, so it's per-browser like the theme choice.
const VEHICLE_KEY = "revive-vehicle";

// Same "newest reading vs now" definition as the selected vehicle's status
// pill, just applied to any vehicle in the switcher list (using the
// `last_seen` /api/vehicles now sends per vehicle) - lets VehiclePicker show
// every vehicle's own online/offline dot while its list is open.
const isVehicleLive = (v) =>
  !!v.last_seen && (Date.now() - new Date(v.last_seen).getTime()) / 60000 <= OFFLINE_THRESHOLD_MIN;

export default function App() {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [vehicleId, setVehicleId] = useState(null);
  const [readings, setReadings] = useState(null);
  const [err, setErr] = useState(null);
  // Distinct from `err` (an actual fetch/API failure): the API answered
  // fine, this deployment/customer just has no vehicles visible right now
  // (fails closed - see _visible_vehicle_ids in api.py). The app shell
  // (sidebar, header) still renders as normal; only the main content area
  // shows this instead of a "Loading…" that would otherwise spin forever -
  // this is a plain empty state, not an error (Joe, 2026-09-12: an empty
  // filtered list, not the whole app going down).
  const [noVehicles, setNoVehicles] = useState(false);
  const vehicle = vehicles.find((v) => v.vehicle_id === vehicleId) || null;

  // Theme: the inline script in index.html already set the .dark class before
  // first paint (from a saved choice, else the OS). Seed state from it, and keep
  // following the OS while the visitor hasn't made an explicit choice.
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [page, setPage] = useState("dashboard");
  // Costing is test-only (WarriorSimulator vehicle only, see NAV's costing
  // entry) - if the vehicle switcher moves off that vehicle while Costing is
  // open (rather than only ever reaching it via its own nav item, which is
  // already filtered out), drop back to Overview instead of rendering it for
  // a vehicle it was never meant to be shown for.
  useEffect(() => {
    if (page === "costing" && vehicle?.source !== "trial_demo") setPage("dashboard");
  }, [page, vehicle]);
  const [reportOpen, setReportOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [splash, setSplash] = useState(true);
  const [logoReady, setLogoReady] = useState(false);

  // Shared cross-filter selection: the day the Overview focuses on. null = the
  // vehicle's newest day (each panel resolves that itself). Lifted here so the
  // route navigator and the day-aware panels stay in sync.
  const [day, setDay] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Follow the OS theme live, but only until the visitor picks one explicitly.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => {
      if (!localStorage.getItem("revive-theme")) setDark(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("revive-theme", next ? "dark" : "light");
  };

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 2600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    getVehicles()
      .then((list) => {
        // Distinct from "can't reach the API" (below): the API answered
        // fine, it just has nothing configured to show - a deployment with
        // no CUSTOMER_ID/VISIBLE_VEHICLES set fails closed (2026-09-12), so
        // this is a real, expected state to surface clearly rather than
        // leave the page stuck on "Loading…" forever.
        if (list.length === 0) {
          setNoVehicles(true);
          return;
        }
        setVehicles(list);
        setVehicleId((cur) => {
          if (cur) return cur;
          // Whichever vehicle was last explicitly picked (see chooseVehicle),
          // if it's still in the list - otherwise the backend's own default
          // (a real vehicle first, then oldest) via list[0].
          const saved = localStorage.getItem(VEHICLE_KEY);
          if (saved && list.some((v) => v.vehicle_id === saved)) return saved;
          return list[0]?.vehicle_id ?? null;
        });
      })
      .catch((e) => setErr(String(e)));
    // Sidebar branding tag - null (no tag shown) for a deployment with no
    // CUSTOMER_ID configured (e.g. the sales demo), never hardcoded.
    getCustomer().then(setCustomer).catch(() => setCustomer(null));
  }, []);

  // Remembers the choice across reloads (see the getVehicles effect above) -
  // use this instead of setVehicleId directly for anything the user actively
  // picks (the switcher, the Fleet page); internal defaulting should keep
  // using setVehicleId so it doesn't overwrite a saved preference.
  const chooseVehicle = (id) => {
    setVehicleId(id);
    localStorage.setItem(VEHICLE_KEY, id);
  };

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setDay(null); // reset the focused day when the vehicle changes
    getLastKnown(vehicleId)
      .then((lk) => live && (setReadings(lk.readings), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId]);

  // null while readings haven't loaded yet; true/false once they have.
  const isLive = useMemo(() => {
    if (!readings) return null;
    const timestamps = Object.values(readings)
      .map((r) => new Date(r.ts).getTime())
      .filter((t) => !Number.isNaN(t));
    if (timestamps.length === 0) return false;
    const newestMin = (Date.now() - Math.max(...timestamps)) / 60000;
    return newestMin <= OFFLINE_THRESHOLD_MIN;
  }, [readings]);

  const fmt = (iso) => fmtDMYTime(iso, vehicle?.timezone);
  const fmtDate = (iso) => fmtDMY(iso, vehicle?.timezone);
  const fmtTime = (iso) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: vehicle?.timezone || "UTC",
      }).format(new Date(iso));
    } catch { return iso; }
  };

  const nav = NAV.find((n) => n.id === page) || NAV[0];
  const goto = (id) => { setPage(id); setNavOpen(false); };

  const splashOverlay = splash && (
    <div className="splash" aria-hidden="true">
      <div className="splash-mark">
        <span className="ring" /><span className="ring" /><span className="ring" />
        <img className={"splash-logo" + (logoReady ? " ready" : "")}
          src="/logo.png" alt="Revive Live" onLoad={() => setLogoReady(true)} />
      </div>
    </div>
  );

  if (err) {
    return (
      <div className="app">{splashOverlay}
        <div className="content"><div className="page">
          <div className="err">
            {t("app.apiError.title")}<br />{err}<br /><br />
            {t("app.apiError.hint")}
          </div>
        </div></div>
      </div>
    );
  }

  const sidebar = (
    <aside className={"sidebar" + (navOpen ? " open" : "")}>
      <div className="sidebar-brand">
        <img className="logo" src="/logo.png" alt="Revive Live" />
        {customer?.name && <span className="sidebar-tag">{customer.name}</span>}
      </div>
      {/* Mobile-only duplicate of the topbar's language/theme toggles - see
          .sidebar-tools / .topbar-actions in styles.css, which show exactly
          one of the two copies depending on viewport width (Joe, 2026-09-13:
          decluttering the topbar on mobile, where it was crowding the
          vehicle picker). A settings page may absorb this later; not needed
          yet. */}
      <div className="sidebar-tools">
        <LanguageToggle />
        <button className="theme-btn" aria-label={t("app.toggleDarkMode")}
          onClick={toggleTheme}>{dark ? "☀" : "☾"}</button>
      </div>
      <div className="nav-group-label">{t("nav.groups.vehicle")}</div>
      {NAV.slice(0, 1).map((n) => (
        <NavItem key={n.id} n={n} active={page === n.id} onClick={() => goto(n.id)} />
      ))}
      {NAV.slice(2)
        .filter((n) => n.id !== "costing" || vehicle?.source === "trial_demo")
        .map((n) => (
          <NavItem key={n.id} n={n} active={page === n.id} onClick={() => goto(n.id)} />
        ))}
      <div className="nav-group-label">{t("nav.groups.fleet")}</div>
      <NavItem n={NAV[1]} active={page === "fleet"} onClick={() => goto("fleet")} />
      <div className="nav-spacer" />
      {SHOW_GENERATE_REPORT && (
        <button className="nav-item tool-action" onClick={() => setReportOpen(true)}>
          <span className="nav-ico"><IconReport /></span> {t("app.generateReport")}
        </button>
      )}
      <div className="sidebar-foot">
        {t("app.lastKnownValues")} · <br /><strong>{vehicle?.name}</strong>
      </div>
    </aside>
  );

  return (
    <div className="app">
      {splashOverlay}
      {sidebar}
      <div className={"sidebar-backdrop" + (navOpen ? " open" : "")}
        onClick={() => setNavOpen(false)} />

      <div className="content">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <button className="mobile-menu-btn" aria-label={t("app.menu")}
              onClick={() => setNavOpen(true)}>☰</button>
            <div className="topbar-title">
              <h1>{t(nav.titleKey)}</h1>
              <div className="crumb">
                <span className="crumb-name">{page === "fleet" ? t("nav.fleet.crumb") : (vehicle?.name || "—")}</span>
                {page !== "fleet" && isLive !== null && (
                  <span className={"status-pill " + (isLive ? "status-live" : "status-offline")}>
                    <span className="status-dot" aria-hidden="true" />
                    <span className="status-label">{isLive ? t("app.live") : t("app.offline")}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            {page !== "fleet" && (
              <div className="select-wrap">
                <span className="caplbl">{t("app.vehicle")}</span>
                <VehiclePicker vehicles={vehicles} vehicleId={vehicleId}
                  onChange={chooseVehicle} isLive={isVehicleLive} />
              </div>
            )}
            <LanguageToggle />
            <button className="theme-btn" aria-label={t("app.toggleDarkMode")}
              onClick={toggleTheme}>{dark ? "☀" : "☾"}</button>
          </div>
        </header>

        <main className="page">
          {noVehicles ? (
            <div className="empty">{t("app.noVehiclesVisible")}</div>
          ) : !readings && page !== "fleet" ? (
            <div className="empty">{t("common.loading")}</div>
          ) : page === "fleet" ? (
            <FleetPage vehicles={vehicles} vehicle={vehicle}
              onSelect={(id) => { chooseVehicle(id); setPage("dashboard"); }} />
          ) : page === "trends" ? (
            <TrendsPage vehicleId={vehicleId} vehicle={vehicle} />
          ) : page === "sustainability" ? (
            <SustainabilityPage vehicleId={vehicleId} vehicle={vehicle} />
          ) : page === "health" ? (
            <HealthPage readings={readings} vehicle={vehicle} fmtDate={fmtDate} />
          ) : page === "alerts" ? (
            <AlertsPage vehicle={vehicle} readings={readings} fmt={fmt} />
          ) : page === "costing" ? (
            <CostingPage vehicleId={vehicleId} vehicle={vehicle} />
          ) : page === "routes" ? (
            <RoutesPage vehicleId={vehicleId} vehicle={vehicle} readings={readings}
              fmt={fmt} fmtTime={fmtTime} day={day} setDay={setDay} />
          ) : page === "pumps" ? (
            <PumpsPage vehicleId={vehicleId} vehicle={vehicle} fmtTime={fmtTime} />
          ) : (
            <OverviewPage vehicleId={vehicleId} vehicle={vehicle} readings={readings}
              fmt={fmt} fmtTime={fmtTime} day={day} setDay={setDay} isLive={isLive} />
          )}
        </main>

        <div className="foot">
          {t("app.footer")} · <strong>{vehicle?.name}</strong><br />
        </div>
      </div>

      {reportOpen && (
        <ReportDialog vehicles={vehicles} vehicleId={vehicleId} readings={readings}
          onClose={() => setReportOpen(false)} />
      )}
      <Analytics />
    </div>
  );
}

function NavItem({ n, active, onClick }) {
  const { t } = useTranslation();
  const { Icon } = n;
  return (
    <button className={"nav-item" + (active ? " active" : "")} onClick={onClick}>
      <span className="nav-ico"><Icon /></span> {t(n.labelKey)}
    </button>
  );
}
