"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowRight,
  Link2,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { demoEvidence } from "@/modules/ad-diagnostics/server/demo";
import { ReportView } from "./report-view";
import s from "./adflow.module.css";
export function AdflowLanding() {
  const t = useTranslations("adflow");
  return (
    <div className={s.root}>
      <header className={s.topbar}>
        <Link className={s.logo} href="/">
          <span className={s.mark}>
            <Activity size={21} />
          </span>
          AdFlow
        </Link>
        <nav className={s.topActions}>
          <Link href="/adflow/demo">{t("tryDemo")}</Link>
          <Link className={s.primary} href="/adflow">
            {t("openWorkspace")}
            <ArrowRight size={14} />
          </Link>
        </nav>
      </header>
      <main>
        <section className={s.hero}>
          <span className={s.pill}>
            <Sparkles size={12} />
            {t("heroBadge")}
          </span>
          <h1>
            {t("heroTitle")}
            <br />
            <em>{t("heroAccent")}</em>
          </h1>
          <p>{t("heroDescription")}</p>
          <div className={s.actions}>
            <Link className={s.primary} href="/adflow">
              {t("connectAccount")}
              <ArrowRight size={16} />
            </Link>
            <Link className={s.secondary} href="/adflow/demo">
              {t("exploreDemo")}
            </Link>
          </div>
          <span className={s.mini}>
            <ShieldCheck size={12} style={{ display: "inline" }} />{" "}
            {t("heroSafety")}
          </span>
          <div className={s.heroPreview}>
            <div className={s.cardHeader}>
              <h2>{t("overview")}</h2>
              <span className={`${s.pill} ${s.demoPill}`}>
                {t("demoBadge")}
              </span>
            </div>
            <ReportView data={demoEvidence()} demo />
          </div>
        </section>
        <section className={s.featureGrid}>
          {[
            {
              icon: Link2,
              title: "featureConnect",
              body: "featureConnectBody",
            },
            {
              icon: Sparkles,
              title: "featureDiagnose",
              body: "featureDiagnoseBody",
            },
            {
              icon: Target,
              title: "featureOptimize",
              body: "featureOptimizeBody",
            },
          ].map((f) => (
            <article key={f.title}>
              <span className={s.featuresIcon}>
                <f.icon size={24} />
              </span>
              <h2>{t(f.title)}</h2>
              <p>{t(f.body)}</p>
            </article>
          ))}
        </section>
      </main>
      <footer className={s.topbar}>
        <span className={s.mini}>AdFlow · {t("footer")}</span>
        <div className={s.topActions}>
          <Link href="/privacy">{t("privacy")}</Link>
          <Link href="/terms">{t("terms")}</Link>
        </div>
      </footer>
    </div>
  );
}
