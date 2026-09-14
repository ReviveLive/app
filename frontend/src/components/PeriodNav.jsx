import { useTranslation } from "react-i18next";

// Prev/Next stepper with a centred period label — the shared navigator for
// paging time-series cards one window at a time. Mirrors the route-history card,
// reusing its .route-nav / .navbtn / .route-day styles. Props:
//   { label, onPrev, onNext, atStart, atEnd }.
export default function PeriodNav({ label, onPrev, onNext, atStart, atEnd }) {
  const { t } = useTranslation();
  return (
    <div className="route-nav">
      <button className="navbtn" disabled={atStart} onClick={onPrev}>‹ {t("common.nav.prev")}</button>
      <span className="route-day">{label}</span>
      <button className="navbtn" disabled={atEnd} onClick={onNext}>{t("common.nav.next")} ›</button>
    </div>
  );
}
