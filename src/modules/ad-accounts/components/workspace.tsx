"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  CreditCard,
  Layers3,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unplug,
} from "lucide-react";
import { api } from "@/trpc/react";
import { useLogin } from "@/components/auth/use-login";
import { usePaymentDialogStore } from "@/stores/payment-dialog-store";
import { demoEvidence } from "@/modules/ad-diagnostics/server/demo";
import { ReportView, type Evidence } from "./report-view";
import s from "./adflow.module.css";

type Tab = "overview" | "accounts" | "reports" | "benchmarks" | "plans";
const demoData = demoEvidence();
export function Workspace({ demo = false }: { demo?: boolean }) {
  const t = useTranslations("adflow"),
    locale = useLocale();
  const { data: session, status: sessionStatus } = useSession();
  const login = useLogin();
  const utils = api.useUtils();
  const [tab, setTab] = useState<Tab>("overview");
  const [accountId, setAccountId] = useState("");
  const [reportId, setReportId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [accountCursor, setAccountCursor] = useState<string>();
  const [reportCursor, setReportCursor] = useState<string>();
  const [discoveryCursor, setDiscoveryCursor] = useState<string>();
  const [connectionCursor, setConnectionCursor] = useState<string>();
  const [industry, setIndustry] = useState("general");
  const [region, setRegion] = useState("GLOBAL");
  const [objective, setObjective] = useState<
    "CONVERSIONS" | "LEADS" | "TRAFFIC" | "AWARENESS"
  >("CONVERSIONS");
  const [notice, setNotice] = useState<string>();
  const [demoStatus, setDemoStatus] = useState<
    "OPEN" | "ACCEPTED" | "DISMISSED"
  >("OPEN");
  const [deleteId, setDeleteId] = useState<string>();
  const [authorizationFailed, setAuthorizationFailed] = useState(false);
  useEffect(() => {
    setAuthorizationFailed(
      new URLSearchParams(window.location.search).get("authorization") ===
        "failed",
    );
  }, []);
  const live = Boolean(session) && !demo;
  const accounts = api.adflow.accounts.useQuery(
    { limit: 20, cursor: accountCursor },
    { enabled: live, refetchInterval: 15000 },
  );
  const selected = accountId || accounts.data?.items[0]?.id || "";
  const account = accounts.data?.items.find((a) => a.id === selected);
  const connections = api.adflow.connections.useQuery(
    { limit: 20, cursor: connectionCursor },
    { enabled: live },
  );
  const config = api.adflow.status.useQuery(undefined, { enabled: live });
  const runs = api.adflow.runs.useQuery(
    { accountId: selected, limit: 20 },
    { enabled: live && Boolean(selected), refetchInterval: 5000 },
  );
  const reports = api.adflow.reports.useQuery(
    { accountId: selected, cursor: reportCursor },
    { enabled: live && Boolean(selected), refetchInterval: 5000 },
  );
  const activeReportId =
    reportId ||
    reports.data?.items.find((r) => r.status === "SUCCEEDED")?.id ||
    "";
  const report = api.adflow.report.useQuery(
    { id: activeReportId },
    { enabled: live && Boolean(activeReportId), refetchInterval: 10000 },
  );
  const discovered = api.adflow.discovered.useQuery(
    { id: connectionId, cursor: discoveryCursor },
    { enabled: live && Boolean(connectionId) },
  );
  const metrics = api.adflow.metrics.useQuery(
    { accountId: selected },
    { enabled: live && Boolean(selected), refetchInterval: 15000 },
  );
  const pendingChange = api.adflow.pendingPlanChange.useQuery(undefined, {
    enabled: live && tab === "plans",
  });
  const [downgradeProduct, setDowngradeProduct] = useState<string>();
  const plans = api.adflow.plans.useQuery(undefined, {
    enabled: live && tab === "plans",
  });
  const refresh = async () => {
    await utils.adflow.invalidate();
  };
  const failed = (error: { message: string }) =>
    setNotice(
      t.has(`errors.${error.message}`)
        ? t(`errors.${error.message}`)
        : t("requestFailed"),
    );
  const downgrade = api.adflow.scheduleDowngrade.useMutation({
    onSuccess: async (result) => {
      setDowngradeProduct(undefined);
      setNotice(
        t("downgradeScheduled", {
          date: new Date(result.effectiveAt).toLocaleDateString(locale),
        }),
      );
      await refresh();
    },
    onError: failed,
  });
  const authorize = api.adflow.authorize.useMutation({
    onSuccess: (result) => window.location.assign(result.url),
    onError: failed,
  });
  const discover = api.adflow.discover.useMutation({
    onSuccess: async (_, input) => {
      setConnectionId(input.id);
      setDiscoveryCursor(undefined);
      await refresh();
    },
    onError: failed,
  });
  const bind = api.adflow.bind.useMutation({
    onSuccess: async (result) => {
      setAccountId(result.id);
      setNotice(t("bound"));
      await refresh();
    },
    onError: failed,
  });
  const sync = api.adflow.sync.useMutation({
    onSuccess: async () => {
      setNotice(t("syncQueued"));
      await refresh();
    },
    onError: failed,
  });
  const diagnose = api.adflow.diagnose.useMutation({
    onSuccess: async () => {
      setNotice(t("diagnosisQueued"));
      setTab("reports");
      await refresh();
    },
    onError: failed,
  });
  const disconnect = api.adflow.disconnect.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const remove = api.adflow.deleteData.useMutation({
    onSuccess: async () => {
      setDeleteId(undefined);
      setAccountId("");
      setReportId("");
      await refresh();
    },
    onError: failed,
  });
  const revoke = api.adflow.revoke.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const recommendation = api.adflow.recommendation.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const openPaymentDialog = usePaymentDialogStore(
    (state) => state.openPaymentDialog,
  );
  const data = demo
    ? demoData
    : ((report.data?.evidence ?? metrics.data) as Evidence | undefined);
  const stateError =
    accounts.error ||
    config.error ||
    report.error ||
    connections.error ||
    plans.error ||
    runs.error ||
    reports.error ||
    discovered.error ||
    metrics.error ||
    pendingChange.error;
  const pending =
    downgrade.isPending ||
    authorize.isPending ||
    discover.isPending ||
    bind.isPending ||
    sync.isPending ||
    diagnose.isPending ||
    disconnect.isPending ||
    remove.isPending ||
    revoke.isPending ||
    recommendation.isPending;
  const tabs = [
    { key: "overview", icon: BarChart3 },
    { key: "accounts", icon: Link2 },
    { key: "reports", icon: BookOpen },
    { key: "benchmarks", icon: Layers3 },
    { key: "plans", icon: CreditCard },
  ] as const;
  const demoAction = () => setNotice(t("demoAction"));
  const connectAction = (platform: "GOOGLE" | "META") =>
    demo ? demoAction() : authorize.mutate({ platform });
  const evidenceBenchmarks =
    (
      report.data?.evidence as {
        benchmarks?: {
          id: string;
          metric: string;
          value: number;
          sourceUrl: string;
          periodEnd: string;
          sampleSize: number;
        }[];
      } | null
    )?.benchmarks ?? [];
  return (
    <div className={s.root}>
      <header className={s.topbar}>
        <Link href="/" className={s.logo}>
          <span className={s.mark}>
            <Activity size={21} />
          </span>
          AdFlow<span className={s.badge}>AI</span>
        </Link>
        <div className={s.topActions}>
          <span className={`${s.pill} ${demo ? s.demoPill : ""}`}>
            <ShieldCheck size={12} />
            {t(demo ? "demoBadge" : "readOnly")}
          </span>
          {demo ? (
            <Link className={s.secondary} href="/adflow">
              {t("connectReal")}
              <ArrowRight size={13} />
            </Link>
          ) : session ? (
            <Link className={s.secondary} href="/account/billing">
              {t("billing")}
            </Link>
          ) : (
            <button
              className={s.primary}
              onClick={() => login.handleModalClose(true)}
            >
              {t("signIn")}
            </button>
          )}
        </div>
      </header>
      <div className={s.layout}>
        <aside className={s.sidebar}>
          <p className={s.navLabel}>{t("workspace")}</p>
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setTab(item.key);
                setNotice(undefined);
              }}
              className={`${s.nav} ${tab === item.key ? s.active : ""}`}
            >
              <item.icon size={17} />
              {t(item.key)}
            </button>
          ))}
          <div className={s.sidebarBottom}>
            <ShieldCheck size={23} />
            <p>{t("privacyNote")}</p>
            <Link href="/privacy">
              {t("privacy")}
              <ChevronRight size={12} style={{ display: "inline" }} />
            </Link>
          </div>
        </aside>
        <main className={s.main}>
          <div className={s.titleRow}>
            <div>
              <div className={s.eyebrow}>{t("workspaceEyebrow")}</div>
              <h1>{t(`titles.${tab}`)}</h1>
              <p className={s.subtitle}>{t(`subtitles.${tab}`)}</p>
            </div>
            <div className={s.actions}>
              {live && accounts.data?.items.length ? (
                <select
                  aria-label={t("chooseAccount")}
                  className={s.select}
                  value={selected}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setReportId("");
                    setReportCursor(undefined);
                  }}
                >
                  {accounts.data.items.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </select>
              ) : null}
              {tab === "overview" && (
                <button
                  className={s.primary}
                  disabled={pending || (!demo && !selected)}
                  onClick={() =>
                    demo
                      ? setTab("reports")
                      : diagnose.mutate({
                          accountId: selected,
                          locale: locale === "zh" ? "zh" : "en",
                        })
                  }
                >
                  <Sparkles size={15} />
                  {t("runDiagnosis")}
                </button>
              )}
            </div>
          </div>
          {demo && (
            <div className={s.banner}>
              <Sparkles size={21} />
              <div>
                <strong>{t("demoTitle")}</strong>
                <br />
                {t("demoDescription")}
              </div>
            </div>
          )}
          {!demo && authorizationFailed && (
            <div className={s.error}>{t("authorizationFailed")}</div>
          )}
          {notice && (
            <div className={s.banner} role="status">
              {notice}
              <button
                className={s.secondary}
                onClick={() => setNotice(undefined)}
              >
                {t("dismissNotice")}
              </button>
            </div>
          )}
          {stateError && (
            <div className={s.error} role="alert">
              {t("requestFailed")}{" "}
              <button className={s.secondary} onClick={() => void refresh()}>
                {t("retry")}
              </button>
            </div>
          )}
          {!demo && sessionStatus === "loading" ? (
            <div className={`${s.empty} ${s.loading}`}>
              <Loader2 />
              {t("loading")}
            </div>
          ) : !demo && !session ? (
            <div className={`${s.card} ${s.empty}`}>
              <ShieldCheck size={38} />
              <h2>{t("loginTitle")}</h2>
              <p>{t("loginDescription")}</p>
              <button
                className={s.primary}
                onClick={() => login.handleModalClose(true)}
              >
                {t("signIn")}
              </button>{" "}
              <Link className={s.secondary} href="/adflow/demo">
                {t("tryDemo")}
              </Link>
            </div>
          ) : (
            <>
              {tab === "overview" && (
                <>
                  {data ? (
                    <ReportView data={data} demo={demo} />
                  ) : (
                    <div className={`${s.card} ${s.empty}`}>
                      <BarChart3 size={38} />
                      <h2>{t("startTitle")}</h2>
                      <p>{t("startDescription")}</p>
                      <button
                        className={s.primary}
                        onClick={() => setTab("accounts")}
                      >
                        {t("connectAccount")}
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                  {!demo && runs.data?.items[0] && (
                    <div className={s.banner}>
                      <RefreshCw size={17} />
                      {t("latestSync")}:{" "}
                      {t(`statuses.${runs.data.items[0].status}`)} ·{" "}
                      {runs.data.items[0].startDate} —{" "}
                      {runs.data.items[0].endDate}
                    </div>
                  )}
                </>
              )}
              {tab === "accounts" && (
                <>
                  <div className={s.banner}>
                    <ShieldCheck size={20} />
                    {t("accountRules")}{" "}
                    {!demo &&
                      config.data &&
                      t("quota", {
                        used: config.data.entitlement.used,
                        limit: config.data.entitlement.limit,
                      })}
                  </div>
                  <div className={s.card}>
                    <div className={s.cardHeader}>
                      <div>
                        <h2>{t("platformConnections")}</h2>
                        <p className={s.mini}>
                          {t("aiDisclosure")}{" "}
                          <Link href="/privacy">{t("privacy")}</Link>
                        </p>
                      </div>
                    </div>
                    <div className={s.actions}>
                      <button
                        className={s.primary}
                        disabled={pending || (!demo && !config.data?.google)}
                        onClick={() => connectAction("GOOGLE")}
                      >
                        <Plus size={14} />
                        {t("connectGoogle")}
                      </button>
                      <button
                        className={s.secondary}
                        disabled={pending || (!demo && !config.data?.meta)}
                        onClick={() => connectAction("META")}
                      >
                        <Plus size={14} />
                        {t("connectMeta")}
                      </button>
                    </div>
                    {!demo && (!config.data?.google || !config.data?.meta) && (
                      <p className={s.mini}>{t("providerNotConfigured")}</p>
                    )}
                    {connections.data?.items.map((c) => (
                      <div className={s.recommendation} key={c.id}>
                        <div className={s.cardHeader}>
                          <div>
                            <strong>{c.platform}</strong>{" "}
                            <span className={s.badge}>
                              {t(`statuses.${c.status}`)}
                            </span>
                          </div>
                          <div className={s.actions}>
                            <button
                              className={s.secondary}
                              disabled={pending || c.status !== "ACTIVE"}
                              onClick={() => discover.mutate({ id: c.id })}
                            >
                              {t("findAccounts")}
                            </button>
                            <button
                              className={s.secondary}
                              disabled={pending}
                              onClick={() => connectAction(c.platform)}
                            >
                              {t("reauthorize")}
                            </button>
                            <button
                              className={s.danger}
                              disabled={pending}
                              onClick={() => revoke.mutate({ id: c.id })}
                            >
                              <Unplug size={13} />
                              {t("revoke")}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {connections.data?.nextCursor && (
                      <button
                        className={s.secondary}
                        onClick={() =>
                          setConnectionCursor(connections.data?.nextCursor)
                        }
                      >
                        {t("next")}
                      </button>
                    )}
                    {connectionId && (
                      <>
                        <div className={s.fields}>
                          <label>
                            {t("industry")}
                            <input
                              className={s.input}
                              value={industry}
                              onChange={(e) => setIndustry(e.target.value)}
                              maxLength={60}
                            />
                          </label>
                          <label>
                            {t("region")}
                            <input
                              className={s.input}
                              value={region}
                              onChange={(e) =>
                                setRegion(e.target.value.toUpperCase())
                              }
                              maxLength={6}
                            />
                          </label>
                          <label>
                            {t("objective")}
                            <select
                              className={s.select}
                              value={objective}
                              onChange={(e) =>
                                setObjective(e.target.value as typeof objective)
                              }
                            >
                              {[
                                "CONVERSIONS",
                                "LEADS",
                                "TRAFFIC",
                                "AWARENESS",
                              ].map((o) => (
                                <option key={o} value={o}>
                                  {t(`objectives.${o}`)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {discovered.data?.items.map((a) => (
                          <div key={a.externalId} className={s.cardHeader}>
                            <span>
                              {a.name}{" "}
                              <span className={s.mini}>
                                {a.currency} · {a.externalId}
                              </span>
                            </span>
                            <button
                              className={s.primary}
                              disabled={pending}
                              onClick={() =>
                                bind.mutate({
                                  connectionId,
                                  externalId: a.externalId,
                                  industry,
                                  region,
                                  objective,
                                })
                              }
                            >
                              {t("bind")}
                            </button>
                          </div>
                        ))}
                        {discovered.data?.nextCursor && (
                          <button
                            className={s.secondary}
                            onClick={() =>
                              setDiscoveryCursor(discovered.data?.nextCursor)
                            }
                          >
                            {t("next")}
                          </button>
                        )}
                        {!discovered.isLoading &&
                          !discovered.data?.items.length && (
                            <p className={s.mini}>
                              {t("noAccessibleAccounts")}
                            </p>
                          )}
                      </>
                    )}
                  </div>
                  <div className={s.card}>
                    <h2>{t("boundAccounts")}</h2>
                    {demo ? (
                      <div className={s.recommendation}>
                        <strong>{t("demoAccount")}</strong>
                        <p className={s.mini}>
                          Google Ads · USD · America/Los_Angeles
                        </p>
                        <button className={s.secondary} onClick={demoAction}>
                          {t("syncNow")}
                        </button>
                      </div>
                    ) : (
                      accounts.data?.items.map((a) => (
                        <div className={s.recommendation} key={a.id}>
                          <div className={s.cardHeader}>
                            <div>
                              <h3>{a.name}</h3>
                              <span className={s.badge}>
                                {a.platform} · {t(`statuses.${a.status}`)}
                              </span>
                              <p className={s.mini}>
                                {a.currency} · {a.timezone}
                              </p>
                            </div>
                            <div className={s.actions}>
                              <button
                                className={s.secondary}
                                disabled={pending || a.status !== "BOUND"}
                                onClick={() => sync.mutate({ accountId: a.id })}
                              >
                                <RefreshCw size={13} />
                                {t("syncNow")}
                              </button>
                              <button
                                className={s.secondary}
                                disabled={pending}
                                onClick={() => disconnect.mutate({ id: a.id })}
                              >
                                {t("disconnect")}
                              </button>
                              <button
                                className={s.danger}
                                disabled={pending}
                                onClick={() => setDeleteId(a.id)}
                              >
                                {t("deleteData")}
                              </button>
                            </div>
                          </div>
                          {deleteId === a.id && (
                            <div className={s.error}>
                              {t("deleteConfirm")}
                              <div className={s.actions}>
                                <button
                                  className={s.danger}
                                  disabled={pending}
                                  onClick={() => remove.mutate({ id: a.id })}
                                >
                                  {t("confirmDelete")}
                                </button>
                                <button
                                  className={s.secondary}
                                  onClick={() => setDeleteId(undefined)}
                                >
                                  {t("cancel")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    {accounts.data?.nextCursor && (
                      <button
                        className={s.secondary}
                        onClick={() =>
                          setAccountCursor(accounts.data?.nextCursor)
                        }
                      >
                        {t("next")}
                      </button>
                    )}
                    {!demo && !accounts.data?.items.length && (
                      <p className={s.empty}>{t("noAccounts")}</p>
                    )}
                  </div>
                </>
              )}
              {tab === "reports" && (
                <>
                  <div className={s.card}>
                    <div className={s.cardHeader}>
                      <h2>{t("reportHistory")}</h2>
                      <button
                        className={s.primary}
                        disabled={
                          pending || (!demo && (!selected || !config.data?.ai))
                        }
                        onClick={() =>
                          demo
                            ? demoAction()
                            : diagnose.mutate({
                                accountId: selected,
                                locale: locale === "zh" ? "zh" : "en",
                              })
                        }
                      >
                        <Sparkles size={14} />
                        {t("runDiagnosis")}
                      </button>
                    </div>
                    {!demo && !config.data?.ai && (
                      <p className={s.mini}>{t("aiNotConfigured")}</p>
                    )}
                    {reports.data?.items.map((r) => (
                      <button
                        className={s.secondary}
                        style={{ margin: "4px" }}
                        key={r.id}
                        onClick={() => setReportId(r.id)}
                      >
                        {new Date(r.createdAt).toLocaleDateString(locale)} ·{" "}
                        {t(`statuses.${r.status}`)}
                      </button>
                    ))}
                    {reports.data?.nextCursor && (
                      <button
                        className={s.secondary}
                        onClick={() =>
                          setReportCursor(reports.data?.nextCursor)
                        }
                      >
                        {t("next")}
                      </button>
                    )}
                    {!demo && !reports.data?.items.length && (
                      <p className={s.empty}>{t("noReports")}</p>
                    )}
                  </div>
                  {demo ? (
                    <section className={s.card}>
                      <span className={s.badge}>
                        <Sparkles size={12} />
                        {t("demoReport")}
                      </span>
                      <h2 style={{ marginTop: 18 }}>
                        {t("demoRecommendationTitle")}
                      </h2>
                      <p className={s.subtitle}>
                        {t("demoRecommendationBody")}
                      </p>
                      <div className={s.recommendation}>
                        <h3>{t("actionPlan")}</h3>
                        <ol>
                          {[1, 2, 3].map((n) => (
                            <li key={n}>{t(`demoStep${n}`)}</li>
                          ))}
                        </ol>
                        <div className={s.actions}>
                          <button
                            className={s.primary}
                            onClick={() => setDemoStatus("ACCEPTED")}
                          >
                            <Check size={13} />
                            {t("accept")}
                          </button>
                          <button
                            className={s.secondary}
                            onClick={() => setDemoStatus("DISMISSED")}
                          >
                            {t("ignore")}
                          </button>
                          <span className={s.badge}>
                            {t(`statuses.${demoStatus}`)}
                          </span>
                        </div>
                      </div>
                    </section>
                  ) : (
                    report.data && (
                      <section className={s.card}>
                        <span className={s.badge}>
                          {t(`statuses.${report.data.status}`)}
                        </span>
                        <p
                          className={s.subtitle}
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          {report.data.summary ?? t("reportPending")}
                        </p>
                        {report.data.errorCode && (
                          <p className={s.error}>{t("processingFailed")}</p>
                        )}
                        {report.data.recommendations.map((r) => (
                          <div className={s.recommendation} key={r.id}>
                            <h3>{r.title}</h3>
                            <p className={s.mini}>{r.rationale}</p>
                            <p className={s.mini}>
                              {t("evidenceId")}: {r.evidenceKey}
                            </p>
                            <ol>
                              {(r.steps as string[]).map((step, index) => (
                                <li key={index}>{step}</li>
                              ))}
                            </ol>
                            <div className={s.actions}>
                              <button
                                className={s.primary}
                                disabled={pending}
                                onClick={() =>
                                  recommendation.mutate({
                                    id: r.id,
                                    status: "ACCEPTED",
                                  })
                                }
                              >
                                {t("accept")}
                              </button>
                              <button
                                className={s.secondary}
                                disabled={pending}
                                onClick={() =>
                                  recommendation.mutate({
                                    id: r.id,
                                    status: "DISMISSED",
                                  })
                                }
                              >
                                {t("ignore")}
                              </button>
                              <button
                                className={s.secondary}
                                disabled={pending}
                                onClick={() =>
                                  recommendation.mutate({
                                    id: r.id,
                                    status: "OPEN",
                                  })
                                }
                              >
                                {t("reopen")}
                              </button>
                              <span className={s.badge}>
                                {t(`statuses.${r.status}`)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </section>
                    )
                  )}
                  {data && <ReportView data={data} demo={demo} />}
                </>
              )}
              {tab === "benchmarks" && (
                <>
                  <div className={s.banner}>
                    <Layers3 size={22} />
                    {t("benchmarkPolicy")}
                  </div>
                  <div className={s.card}>
                    <h2>{t("matchedBenchmarks")}</h2>
                    {!evidenceBenchmarks.length ? (
                      <div className={s.empty}>
                        <Layers3 size={35} />
                        <h2>{t("noBenchmark")}</h2>
                        <p>{t("noBenchmarkDescription")}</p>
                      </div>
                    ) : (
                      evidenceBenchmarks.map((b) => (
                        <div key={b.id} className={s.recommendation}>
                          <h3>
                            {t(b.metric)}: {b.value}
                          </h3>
                          <p className={s.mini}>
                            {t("yourValue")}:{" "}
                            {data
                              ? (data.metrics[
                                  b.metric as keyof Evidence["metrics"]
                                ] ?? "—")
                              : "—"}
                          </p>
                          <a
                            className={s.secondary}
                            href={b.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("source")}
                            <ArrowRight size={12} />
                          </a>
                          <p className={s.mini}>
                            {b.periodEnd} ·{" "}
                            {t("sampleSize", { count: b.sampleSize })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
              {tab === "plans" && (
                <>
                  <div className={s.banner}>
                    <CreditCard size={22} />
                    {t("pricingPolicy")}
                  </div>
                  {downgradeProduct && (
                    <div className={s.banner}>
                      <div>
                        {t("downgradeConfirm")}
                        <div className={s.actions}>
                          <button
                            className={s.primary}
                            disabled={pending}
                            onClick={() =>
                              downgrade.mutate({ productId: downgradeProduct })
                            }
                          >
                            {t("confirmDowngrade")}
                          </button>
                          <button
                            className={s.secondary}
                            onClick={() => setDowngradeProduct(undefined)}
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {pendingChange.data && (
                    <div className={s.banner}>
                      {t("pendingDowngrade", {
                        limit: pendingChange.data.targetLimit,
                        date: new Date(
                          pendingChange.data.effectiveAt,
                        ).toLocaleDateString(locale),
                      })}
                    </div>
                  )}
                  <div className={s.planGrid}>
                    {[1, 5, 20].map((limit, index) => {
                      const plan = plans.data?.find((p) => p.limit === limit);
                      return (
                        <div key={limit} className={`${s.card} ${s.planCard}`}>
                          <span className={s.eyebrow}>{t(`plan${index}`)}</span>
                          <div className={s.planValue}>
                            {limit}
                            <span className={s.mini}> {t("adAccounts")}</span>
                          </div>
                          <p className={s.subtitle}>{t("planIncludes")}</p>
                          <div className={s.line} />
                          <h2>
                            {plan
                              ? new Intl.NumberFormat(locale, {
                                  style: "currency",
                                  currency: plan.currency,
                                }).format(plan.amount / 100)
                              : t("pricePending")}
                          </h2>
                          <p className={s.mini}>{t("monthly")}</p>
                          <button
                            className={s.primary}
                            disabled={!demo && !plan}
                            onClick={() => {
                              if (demo) {
                                demoAction();
                                return;
                              }
                              if (
                                plan &&
                                config.data &&
                                plan.limit < config.data.entitlement.limit
                              ) {
                                setDowngradeProduct(plan.id);
                                return;
                              }
                              if (plan)
                                openPaymentDialog({
                                  productId: plan.id,
                                  amount: plan.amount,
                                  currency: plan.currency,
                                  successUrl: `${window.location.origin}/adflow`,
                                  cancelUrl: `${window.location.origin}/adflow`,
                                });
                            }}
                          >
                            {t("subscribe")}
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {!demo && (
                    <Link
                      className={s.secondary}
                      href="/account/manage-subscription"
                    >
                      {t("manageSubscription")}
                    </Link>
                  )}
                </>
              )}
            </>
          )}
          <footer className={s.footer}>
            <span>AdFlow · {t("footer")}</span>
            <span>
              {demo
                ? t("demoPeriod")
                : account
                  ? `${account.currency} · ${account.timezone}`
                  : t("secureByDesign")}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
