"use client";
import { useTranslations, useLocale } from "next-intl";
import {
  Activity,
  ArrowUpRight,
  MousePointer2,
  Wallet,
  Target,
  Sparkles,
  CircleCheck,
} from "lucide-react";
import type { evidence } from "@/modules/ad-diagnostics/server/metrics";
import s from "./adflow.module.css";
export type Evidence = ReturnType<typeof evidence>;
export function ReportView({
  data,
  demo = false,
}: {
  data: Evidence;
  demo?: boolean;
}) {
  const t = useTranslations("adflow"),
    locale = useLocale();
  const money = (value: number | null) =>
    value === null
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: data.currency,
          maximumFractionDigits: 2,
        }).format(value);
  const number = (value: number | null, suffix = "") =>
    value === null
      ? "—"
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
          value,
        ) + suffix;
  const metrics = [
    {
      label: "spend",
      value: money(data.metrics.spend),
      icon: Wallet,
      prior: money(data.previous.spend),
    },
    {
      label: "ctr",
      value: number(data.metrics.ctr, "%"),
      icon: MousePointer2,
      prior: number(data.previous.ctr, "%"),
    },
    {
      label: "conversions",
      value: number(data.metrics.conversions),
      icon: Target,
      prior: number(data.previous.conversions),
    },
    {
      label: "roas",
      value: number(data.metrics.roas, "×"),
      icon: ArrowUpRight,
      prior: number(data.previous.roas, "×"),
    },
  ];
  const flagged = data.findings.filter((f) => f.flags.length > 0);
  const max = Math.max(...data.findings.map((f) => f.metrics.spend), 1);
  return (
    <>
      <div className={s.stats}>
        {metrics.map((m) => (
          <div className={s.stat} key={m.label}>
            <div className={s.statLabel}>
              {t(m.label)}
              <m.icon size={15} />
            </div>
            <div className={s.statValue}>{m.value}</div>
            <div className={s.statFoot}>
              {t("previous")}: {m.prior}
            </div>
          </div>
        ))}
      </div>
      <div className={s.grid}>
        <section className={s.card}>
          <div className={s.cardHeader}>
            <div>
              <h2>{t("spendDistribution")}</h2>
              <p className={s.mini}>{t("topAds")}</p>
            </div>
            <span className={s.badge}>{data.currency}</span>
          </div>
          <div
            className={s.chart}
            role="img"
            aria-label={t("spendDistribution")}
          >
            {data.findings.slice(0, 16).map((f) => (
              <div
                key={f.key}
                className={s.bar}
                style={{
                  height: `${Math.max(3, (f.metrics.spend / max) * 100)}%`,
                }}
                title={`${f.name}: ${money(f.metrics.spend)}`}
              />
            ))}
          </div>
          <div className={s.chartLabels}>
            <span>{data.currentStart}</span>
            <span>{data.endDate}</span>
          </div>
        </section>
        <section className={s.card}>
          <h2>{t("diagnosticSignals")}</h2>
          <p className={s.mini}>{t("evidenceBased")}</p>
          <div className={s.scoreRow}>
            <div className={s.score}>
              <strong>{flagged.length}</strong>
              <small>{t("flaggedAds")}</small>
            </div>
            <div>
              <span className={s.badge}>
                <Sparkles size={12} />
                {t("ruleSignals")}
              </span>
              <p className={s.mini}>
                {t("reviewSignals", { count: data.findings.length })}
              </p>
            </div>
          </div>
          <div className={s.line} />
          <p className={s.mini}>
            <CircleCheck size={12} style={{ display: "inline" }} />{" "}
            {demo ? t("demoEvidence") : t("traceable")}
          </p>
        </section>
      </div>
      <section className={s.card}>
        <div className={s.cardHeader}>
          <div>
            <h2>{t("adPerformance")}</h2>
            <p className={s.mini}>{t("tableHelp")}</p>
          </div>
          <Activity size={18} color="#9b89d8" />
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {["ad", "spend", "ctr", "cpc", "cvr", "cpa", "signals"].map(
                  (x) => (
                    <th key={x}>{t(x)}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.findings.slice(0, 20).map((f) => (
                <tr key={f.key}>
                  <td>
                    <div>{f.name}</div>
                    <div className={s.mini}>
                      {f.campaign} · {f.group}
                    </div>
                  </td>
                  <td>{money(f.metrics.spend)}</td>
                  <td>{number(f.metrics.ctr, "%")}</td>
                  <td>{money(f.metrics.cpc)}</td>
                  <td>{number(f.metrics.cvr, "%")}</td>
                  <td>{money(f.metrics.cpa)}</td>
                  <td>
                    {f.flags.length ? (
                      f.flags.map((flag) => (
                        <div key={flag} className={`${s.badge} ${s.warning}`}>
                          {t(`flags.${flag}`)}
                        </div>
                      ))
                    ) : (
                      <span className={s.badge}>{t("noSignal")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.findings.length && <p className={s.empty}>{t("noData")}</p>}
        <p className={s.mini}>
          {t("attribution")}: {data.attribution} · {data.timezone} ·{" "}
          {data.conversionMetric}
        </p>
        <p className={s.mini}>{t("limits")}</p>
      </section>
    </>
  );
}
