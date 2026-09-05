import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import s from "./adflow.module.css";
export async function AdflowLegalPage({
  kind,
}: {
  kind: "privacy" | "terms" | "refund";
}) {
  const t = await getTranslations("adflow");
  return (
    <div className={s.root}>
      <header className={s.topbar}>
        <Link href="/" className={s.logo}>
          AdFlow
        </Link>
        <Link className={s.secondary} href="/adflow">
          {t("openWorkspace")}
        </Link>
      </header>
      <main className={s.main} style={{ maxWidth: 850 }}>
        <div className={s.titleRow}>
          <h1>{t(`legal.${kind}.title`)}</h1>
        </div>
        {[1, 2, 3].map((n) => (
          <section className={s.card} key={n}>
            <h2>{t(`legal.${kind}.heading${n}`)}</h2>
            <p className={s.subtitle}>{t(`legal.${kind}.body${n}`)}</p>
          </section>
        ))}
        <p className={s.mini}>
          {t("legal.contact")}{" "}
          {env.NEXT_PUBLIC_SUPPORT_EMAIL ? (
            <a href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>
              {env.NEXT_PUBLIC_SUPPORT_EMAIL}
            </a>
          ) : (
            t("legal.contactPending")
          )}
        </p>
      </main>
    </div>
  );
}
