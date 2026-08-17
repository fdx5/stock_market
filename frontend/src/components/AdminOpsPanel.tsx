import { useEffect, useState } from "react";
import {
  AdminAuthError,
  BatchRegion,
  DramPriceStatus,
  KakaoDramPriceStatus,
  KakaoPredictionStatus,
  KakaoVisitorStatus,
  MailSend,
  MailStatus,
  PredictionStatus,
  adminApi,
  clearStoredSession,
} from "../adminApi";
import { navigate } from "../router";
import OperationCard, { OperationTone } from "./OperationCard";

/** How the 60% qualitative layer was produced, as reported per market by
 * ai_analyst (SOURCE_CLAUDE / SOURCE_HEURISTIC). The distinction is the panel's
 * whole reason for showing this: a heuristic run is a *successful* run of a
 * degraded pipeline, so it gets the warning ramp rather than the failure one —
 * nothing is broken, but the analysis is the offline lexicon engine, not Claude. */
const AI_SOURCE_META: Record<string, { label: string; tone: string }> = {
  claude: { label: "Claude", tone: "claude" },
  heuristic: { label: "휴리스틱", tone: "heuristic" },
};

/** A run that skipped a dozen thin-history names would otherwise push the second
 * region's card far down this grid. */
const WARNING_PREVIEW_COUNT = 2;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function handleAuthError(err: unknown) {
  if (err instanceof AdminAuthError) {
    clearStoredSession();
    navigate("/admin");
  }
}

/** 운영 탭 — AI 예측 배치, D램 현물가격 배치, 예측 메일 발송, 카카오 알림. 전부
 * "상태 + 이름 + 메타 + 실행 버튼" 모양이라 OperationCard 하나로 통일했다. 각 섹션이
 * 소유한 상태·폴링·버튼 핸들러는 기존 AdminDashboardPage.tsx 로직을 그대로 옮긴 것 —
 * 백엔드 계약은 손대지 않았다. */
export default function AdminOpsPanel() {
  const [prediction, setPrediction] = useState<PredictionStatus | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runningRegion, setRunningRegion] = useState<BatchRegion | null>(null);
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(new Set());

  const [dramStatus, setDramStatus] = useState<DramPriceStatus | null>(null);
  const [runningDram, setRunningDram] = useState(false);
  const [dramRunError, setDramRunError] = useState<string | null>(null);

  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  const [mailHistory, setMailHistory] = useState<MailSend[] | null>(null);
  const [mailSending, setMailSending] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [mailResult, setMailResult] = useState<string | null>(null);

  const [kakaoVisitorStatus, setKakaoVisitorStatus] = useState<KakaoVisitorStatus | null>(null);
  const [kakaoVisitorRunning, setKakaoVisitorRunning] = useState(false);
  const [kakaoVisitorError, setKakaoVisitorError] = useState<string | null>(null);

  const [kakaoPredictionStatus, setKakaoPredictionStatus] = useState<KakaoPredictionStatus | null>(null);
  const [kakaoPredictionRunning, setKakaoPredictionRunning] = useState<BatchRegion | null>(null);
  const [kakaoPredictionError, setKakaoPredictionError] = useState<string | null>(null);

  const [kakaoDramStatus, setKakaoDramStatus] = useState<KakaoDramPriceStatus | null>(null);
  const [kakaoDramRunning, setKakaoDramRunning] = useState(false);
  const [kakaoDramError, setKakaoDramError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => adminApi.predictionStatus().then((s) => !cancelled && setPrediction(s)).catch(handleAuthError);
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => adminApi.dramPriceStatus().then((s) => !cancelled && setDramStatus(s)).catch(handleAuthError);
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      adminApi.kakaoVisitorStatus().then((s) => !cancelled && setKakaoVisitorStatus(s)).catch(handleAuthError);
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      adminApi.kakaoPredictionStatus().then((s) => !cancelled && setKakaoPredictionStatus(s)).catch(handleAuthError);
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      adminApi.kakaoDramPriceStatus().then((s) => !cancelled && setKakaoDramStatus(s)).catch(handleAuthError);
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function loadMail() {
    adminApi.mailStatus().then(setMailStatus).catch(handleAuthError);
    adminApi.mailHistory(40).then((r) => setMailHistory(r.items)).catch(handleAuthError);
  }
  useEffect(loadMail, []);

  function toggleWarnings(key: string) {
    setExpandedWarnings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleRunBatch(region: BatchRegion) {
    if (runningRegion) return;
    const label = region === "KR" ? "코스피·코스닥" : "나스닥";
    if (!window.confirm(`${label} 배치를 지금 재실행하시겠습니까? 해당 일자 데이터를 삭제 후 재생성합니다.`)) return;
    setRunningRegion(region);
    setRunError(null);
    adminApi
      .runPrediction(region)
      .then(() => adminApi.predictionStatus().then((s) => setPrediction(s)))
      .catch((err) => {
        handleAuthError(err);
        setRunError(err instanceof Error ? err.message : "배치 실행에 실패했습니다.");
      })
      .finally(() => setRunningRegion(null));
  }

  function handleRunDramBatch() {
    if (runningDram) return;
    setRunningDram(true);
    setDramRunError(null);
    adminApi
      .runDramPriceBatch()
      .then(() => adminApi.dramPriceStatus().then((s) => setDramStatus(s)))
      .catch((err) => {
        handleAuthError(err);
        setDramRunError(err instanceof Error ? err.message : "배치 실행에 실패했습니다.");
      })
      .finally(() => setRunningDram(false));
  }

  /** 수기 발송. `account` is the masked handle from the status call, or undefined for
   * every account at once. Manual sends deliberately ignore the once-a-day cap the
   * scheduled batch observes — that is what makes this button worth having. */
  function handleSendMail(account?: string, label?: string) {
    if (mailSending) return;
    const who = label ?? "구독 중인 모든 계정";
    if (!window.confirm(`${who}에 예측 메일을 지금 발송하시겠습니까?\n하루 1회 제한과 무관하게 즉시 발송됩니다.`)) return;
    setMailSending(account ?? "*");
    setMailError(null);
    setMailResult(null);
    adminApi
      .runMailSend(account)
      .then((report) => {
        const sent = report.results.reduce((n, r) => n + r.sent.length, 0);
        const failures = report.results.flatMap((r) => r.failed ?? []);
        const skipped = report.results.flatMap((r) => r.skipped ?? []);
        setMailResult(report.note ?? `${sent}건 발송 완료${skipped.length ? ` · ${skipped.length}건 건너뜀` : ""}`);
        if (failures.length) setMailError(`${failures.length}건 실패 — ${failures[0].code}: ${failures[0].error}`);
        loadMail();
      })
      .catch((err) => {
        handleAuthError(err);
        setMailError(err instanceof Error ? err.message : "메일 발송에 실패했습니다.");
      })
      .finally(() => setMailSending(null));
  }

  function handleRunKakaoVisitorNotify() {
    if (kakaoVisitorRunning) return;
    setKakaoVisitorRunning(true);
    setKakaoVisitorError(null);
    adminApi
      .runKakaoVisitorNotify()
      .then((r) => setKakaoVisitorStatus((prev) => (prev ? { ...prev, last_run: r } : { configured: true, last_run: r })))
      .catch((err) => {
        handleAuthError(err);
        setKakaoVisitorError(err instanceof Error ? err.message : "카카오 알림 발송에 실패했습니다.");
      })
      .finally(() => setKakaoVisitorRunning(false));
  }

  function handleRunKakaoPredictionNotify(region: BatchRegion) {
    if (kakaoPredictionRunning) return;
    setKakaoPredictionRunning(region);
    setKakaoPredictionError(null);
    adminApi
      .runKakaoPredictionNotify(region)
      .then((r) =>
        setKakaoPredictionStatus((prev) =>
          prev ? { ...prev, last_runs: { ...prev.last_runs, [region]: r } } : { configured: true, last_runs: { [region]: r } }
        )
      )
      .catch((err) => {
        handleAuthError(err);
        setKakaoPredictionError(err instanceof Error ? err.message : "카카오 알림 발송에 실패했습니다.");
      })
      .finally(() => setKakaoPredictionRunning(null));
  }

  function handleRunKakaoDramNotify() {
    if (kakaoDramRunning) return;
    setKakaoDramRunning(true);
    setKakaoDramError(null);
    adminApi
      .runKakaoDramPriceNotify()
      .then((r) => setKakaoDramStatus((prev) => (prev ? { ...prev, last_run: r } : { configured: true, last_run: r })))
      .catch((err) => {
        handleAuthError(err);
        setKakaoDramError(err instanceof Error ? err.message : "카카오 알림 발송에 실패했습니다.");
      })
      .finally(() => setKakaoDramRunning(false));
  }

  const expiresAt = kakaoVisitorStatus?.token?.refresh_expires_at ?? kakaoPredictionStatus?.token?.refresh_expires_at ?? null;
  const daysLeft = expiresAt ? (new Date(expiresAt).getTime() - Date.now()) / 86_400_000 : null;

  return (
    <div className="admin-ops-tab">
      <section className="admin-ops-section">
        <h2 className="admin-ops-heading">
          <span className="admin-live-dot" /> 배치
        </h2>
        <div className="admin-ops-grid">
          {prediction === null ? (
            <div className="admin-batch-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ) : (
            (["KR", "US"] as BatchRegion[]).map((region) => {
              const label = region === "KR" ? "한국장 (코스피·코스닥)" : "미국장 (나스닥)";
              const last = prediction.last_runs[region] ?? null;
              const isRunning = prediction.running.includes(region) || runningRegion === region;
              const marketStats = (prediction.regions[region] ?? []).map((m) => prediction.markets[m]).filter(Boolean);
              const dbUpdated = marketStats.length ? marketStats.map((m) => m.updated_at).sort().slice(-1)[0] : null;
              const dbCount = marketStats.reduce((sum, m) => sum + m.count, 0);
              const finishedAt = last?.finished_at ?? dbUpdated;
              const ok = last ? last.status === "ok" || last.status === "skipped" : dbCount > 0;
              const tone: OperationTone = isRunning ? "running" : ok ? "ok" : "fail";
              const statusLabel = isRunning
                ? "실행 중"
                : last
                  ? last.status === "ok"
                    ? "성공"
                    : last.status === "skipped"
                      ? "스킵"
                      : "실패"
                  : dbCount > 0
                    ? "성공"
                    : "기록 없음";
              const sources = (prediction.regions[region] ?? [])
                .map((market) => ({ market, stat: last?.markets?.[market] }))
                .filter((entry): entry is { market: string; stat: { count: number; ai_source: string } } => Boolean(entry.stat));
              const warnings = last?.warnings ?? [];
              const warnKey = `warn-${region}`;
              const warnExpanded = expandedWarnings.has(warnKey);
              const shownWarnings = warnExpanded ? warnings : warnings.slice(0, WARNING_PREVIEW_COUNT);
              return (
                <OperationCard
                  key={region}
                  tone={tone}
                  statusLabel={statusLabel}
                  name={label}
                  meta={
                    <>
                      {last?.saved != null && last.status === "ok" ? `${last.saved}종목 저장 · ` : ""}
                      {last?.triggered_by === "admin" ? "수동 · " : ""}
                      {finishedAt ? `최근 ${formatDateTime(finishedAt)}` : "실행 이력 없음"}
                      {last?.error ? ` · ${last.error}` : ""}
                    </>
                  }
                  action={{
                    label: isRunning ? "실행 중..." : "수동 재실행",
                    onClick: () => handleRunBatch(region),
                    disabled: isRunning || runningRegion !== null,
                  }}
                  error={runError}
                  detail={
                    (sources.length > 0 || last?.elapsed_seconds != null || warnings.length > 0) && (
                      <>
                        {(sources.length > 0 || last?.elapsed_seconds != null) && (
                          <div className="admin-batch-detail">
                            {sources.map(({ market, stat }) => {
                              const meta = AI_SOURCE_META[stat.ai_source] ?? { label: stat.ai_source, tone: "unknown" };
                              return (
                                <span
                                  key={market}
                                  className={`admin-batch-source admin-batch-source--${meta.tone}`}
                                  title={`${market} ${stat.count}종목 · 60% 정성 판단: ${meta.label}`}
                                >
                                  <span className="admin-batch-source-market">{market}</span>
                                  {meta.label}
                                  <span className="admin-batch-source-count">{stat.count}</span>
                                </span>
                              );
                            })}
                            {last?.predict_date && (
                              <span className="admin-batch-detail-note">
                                예측일 {last.predict_date.slice(5)}
                                {last.predict_weekday ? `(${last.predict_weekday})` : ""}
                              </span>
                            )}
                            {last?.elapsed_seconds != null && (
                              <span className="admin-batch-detail-note">{last.elapsed_seconds}초 소요</span>
                            )}
                          </div>
                        )}
                        {warnings.length > 0 && (
                          <ul className="admin-batch-warnings">
                            {shownWarnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                            {warnings.length > WARNING_PREVIEW_COUNT && (
                              <li>
                                <button
                                  type="button"
                                  className="admin-batch-warnings-more"
                                  aria-expanded={warnExpanded}
                                  onClick={() => toggleWarnings(warnKey)}
                                >
                                  {warnExpanded ? "접기" : `외 ${warnings.length - WARNING_PREVIEW_COUNT}건 더 보기`}
                                </button>
                              </li>
                            )}
                          </ul>
                        )}
                      </>
                    )
                  }
                />
              );
            })
          )}

          {dramStatus === null ? (
            <div className="admin-batch-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ) : (
            (() => {
              const last = dramStatus.last_run;
              const isRunning = dramStatus.running || runningDram;
              const ok = last ? last.status === "ok" || last.status === "skipped" : dramStatus.item_count > 0;
              const tone: OperationTone = isRunning ? "running" : ok ? "ok" : "fail";
              const statusLabel = isRunning
                ? "실행 중"
                : last
                  ? last.status === "ok"
                    ? "성공"
                    : last.status === "skipped"
                      ? "스킵"
                      : "실패"
                  : dramStatus.item_count > 0
                    ? "성공"
                    : "기록 없음";
              const finishedAt = last?.finished_at;
              const priceDate = last?.price_date ?? dramStatus.latest_price_date;
              const itemCount = last?.item_count ?? dramStatus.item_count;
              return (
                <OperationCard
                  tone={tone}
                  statusLabel={statusLabel}
                  name="D램 현물가격 (TrendForce)"
                  meta={
                    <>
                      {priceDate ? `기준일 ${priceDate} · ${itemCount}개 항목 · ` : ""}
                      {last?.triggered_by === "admin" ? "수동 · " : ""}
                      {finishedAt ? `최근 ${formatDateTime(finishedAt)}` : "실행 이력 없음"}
                      {last?.error ? ` · ${last.error}` : ""}
                    </>
                  }
                  action={{ label: isRunning ? "실행 중..." : "수동 재실행", onClick: handleRunDramBatch, disabled: isRunning }}
                  error={dramRunError}
                />
              );
            })()
          )}
        </div>
      </section>

      <section className="admin-ops-section">
        <h2 className="admin-ops-heading admin-mail-heading">
          <span className="admin-live-dot" /> 예측 메일 발송
          {mailStatus &&
            (mailStatus.configured ? (
              <span className="admin-mail-backend">
                {mailStatus.backend === "resend" ? (mailStatus.smtp_fallback ? "API 발송 (SMTP 예비)" : "API 발송") : "SMTP 발송"}
              </span>
            ) : (
              <span className="admin-mail-unconfigured">발송 설정 필요</span>
            ))}
        </h2>
        {mailStatus && !mailStatus.configured && (
          <div className="admin-mail-diag">
            {mailStatus.diagnosis.unrecognized_names.length > 0 ? (
              <p>
                <code>{mailStatus.diagnosis.unrecognized_names.join(", ")}</code> 이(가) 설정되어 있습니다. 이 앱이 읽는
                이름은 <code>PREDICTION_MAIL_RESEND_KEY</code> 입니다 — 이름을 바꿔 다시 등록하세요.
              </p>
            ) : (
              <p>
                서버가 <code>PREDICTION_MAIL_RESEND_KEY</code> 를 보지 못하고 있습니다. 아래 <b>메일 설정</b>에서 바로
                저장하면 재배포 없이 적용됩니다.
              </p>
            )}
            <span className="admin-mail-diag-vars">
              {Object.entries(mailStatus.diagnosis.present).map(([k, v]) => (
                <span key={k} className={v ? "is-set" : ""}>
                  {k.replace("PREDICTION_MAIL_", "")}: {v ? "설정됨" : "없음"}
                </span>
              ))}
            </span>
          </div>
        )}
        <p className="admin-mail-schedule">
          예측 배치가 끝나고 <b>10분 뒤</b> 해당 시장 구독 종목만 자동 발송됩니다 — 코스피·코스닥은 23:10 KST, 나스닥은
          23:10 ET(한국 시간 낮 12~13시)경. 같은 예측일자는 한 번만 나가고, 아래 수기 발송 버튼은 그 제한과 무관하게 즉시
          보냅니다.
        </p>
        {mailStatus && mailStatus.configured && mailStatus.backend === "resend" && !mailStatus.smtp_fallback && mailStatus.accounts.length > 1 && (
          <div className="admin-mail-diag">
            <p>
              발신 도메인이 인증되지 않은 상태에서는 <b>Resend 가입 주소로만</b> 발송됩니다. 구독 계정이{" "}
              {mailStatus.accounts.length}개이므로 나머지 계정은 발송이 거부됩니다 — Resend에서 발신 도메인을 인증하거나,{" "}
              <code>PREDICTION_MAIL_USER</code> / <code>PREDICTION_MAIL_PASSWORD</code> 를 등록해 SMTP 예비 발송을
              켜세요.
            </p>
          </div>
        )}
        <div className="admin-ops-grid">
          {mailStatus === null ? (
            <div className="admin-batch-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ) : mailStatus.accounts.length === 0 ? (
            <p className="admin-empty">구독 중인 계정이 없습니다.</p>
          ) : (
            mailStatus.accounts.map((acct) => {
              const busy = mailSending === acct.id;
              const codes = acct.stocks.filter((s) => s.active);
              return (
                <OperationCard
                  key={acct.id}
                  tone={busy ? "running" : acct.sent_today > 0 ? "ok" : "idle"}
                  statusLabel={busy ? "발송 중" : acct.sent_today > 0 ? `오늘 ${acct.sent_today}건` : "미발송"}
                  name={acct.email}
                  meta={`${codes.length}종목 · ${acct.last_sent_at ? `최근 ${formatDateTime(acct.last_sent_at)}` : "발송 이력 없음"}`}
                  action={{
                    label: busy ? "발송 중..." : "수기 발송",
                    onClick: () => handleSendMail(acct.id, acct.email),
                    disabled: mailSending !== null || !(acct.resend_key || mailStatus.configured),
                  }}
                  detail={
                    <div className="admin-batch-detail">
                      {codes.map((s) => (
                        <span key={s.code} className="admin-mail-code">
                          {s.name ?? s.code}
                        </span>
                      ))}
                    </div>
                  }
                />
              );
            })
          )}
        </div>
        {mailStatus && mailStatus.accounts.length > 1 && (
          <div className="admin-batch-row admin-mail-allrow">
            <span className="admin-batch-meta">구독 중인 전체 계정에 한 번에 발송</span>
            <button
              type="button"
              className="admin-batch-run-btn"
              disabled={mailSending !== null || !mailStatus.configured}
              onClick={() => handleSendMail(undefined, "구독 중인 모든 계정")}
            >
              {mailSending === "*" ? "발송 중..." : "전체 수기 발송"}
            </button>
          </div>
        )}
        {mailResult && <p className="admin-mail-result">{mailResult}</p>}
        {mailError && <p className="admin-batch-error">{mailError}</p>}

        <h3 className="admin-notify-section-title">발송 이력</h3>
        {mailHistory === null ? (
          <span className="admin-skeleton admin-skeleton--row" />
        ) : mailHistory.length === 0 ? (
          <p className="admin-empty">발송 이력이 없습니다.</p>
        ) : (
          <div className="admin-mail-log">
            {mailHistory.map((h, i) => (
              <div key={i} className="admin-mail-log-row">
                <span className={`admin-mail-log-status admin-mail-log-status--${h.status === "sent" ? "ok" : "fail"}`}>
                  {h.status === "sent" ? "성공" : "실패"}
                </span>
                <span className="admin-mail-log-stock">{h.stock_name ?? h.stock_code}</span>
                <span className="admin-mail-log-addr">{h.email}</span>
                <span className="admin-mail-log-kind">{h.manual ? "수기" : "자동"}</span>
                <span className="admin-mail-log-time">{formatDateTime(h.sent_at)}</span>
                {h.error && <span className="admin-mail-log-error">{h.error}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="admin-ops-section">
        <h2 className="admin-ops-heading">
          <span className="admin-live-dot" /> 카카오 알림
        </h2>
        {daysLeft !== null && daysLeft <= 14 && (
          <p className="admin-batch-error">
            {daysLeft <= 0
              ? `카카오 refresh 토큰이 만료되었습니다 (${formatDateTime(expiresAt as string)}). scripts/kakao_get_refresh_token.py로 재발급이 필요합니다.`
              : `카카오 refresh 토큰이 ${Math.ceil(daysLeft)}일 뒤 만료됩니다 (${formatDateTime(expiresAt as string)}). scripts/kakao_get_refresh_token.py로 재발급해 주세요.`}
          </p>
        )}
        <div className="admin-ops-grid">
          {kakaoVisitorStatus === null ? (
            <div className="admin-batch-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ) : (
            (() => {
              const last = kakaoVisitorStatus.last_run ?? null;
              const configured = kakaoVisitorStatus.configured;
              const tone: OperationTone = kakaoVisitorRunning
                ? "running"
                : !configured
                  ? "neutral"
                  : last
                    ? last.status === "sent" || last.status === "skipped_recent" || last.status === "skipped_quiet_hours"
                      ? "ok"
                      : "fail"
                    : "neutral";
              const statusLabel = kakaoVisitorRunning
                ? "발송 중"
                : !configured
                  ? "미설정"
                  : last
                    ? last.status === "sent"
                      ? "성공"
                      : last.status === "skipped_recent"
                        ? "스킵"
                        : last.status === "skipped_quiet_hours"
                          ? "스킵(새벽)"
                          : last.status === "error"
                            ? "실패"
                            : "미설정"
                    : "기록 없음";
              const triggeredLabel =
                last?.triggered_by === "admin" ? "수동" : last?.triggered_by === "in_process" ? "자동(서버)" : last?.triggered_by === "cron" ? "자동(cron)" : null;
              const metaText = !configured
                ? "REST API 키 · 토큰 설정이 필요합니다."
                : last
                  ? `${triggeredLabel ? `${triggeredLabel} · ` : ""}${formatDateTime(last.finished_at)}` +
                    (last.status === "error" && last.error ? ` · ${last.error}` : "") +
                    (last.status === "skipped_recent" && last.last_sent_at ? ` · 최근 발송 ${formatDateTime(last.last_sent_at)}` : "") +
                    (last.status === "skipped_quiet_hours" ? " · 새벽 1~5시는 발송하지 않습니다" : "")
                  : "아직 실행 이력이 없습니다.";
              return (
                <OperationCard
                  tone={tone}
                  statusLabel={statusLabel}
                  name="사이트 방문자 현황"
                  meta={metaText}
                  action={{ label: kakaoVisitorRunning ? "발송 중..." : "지금 발송", onClick: handleRunKakaoVisitorNotify, disabled: kakaoVisitorRunning }}
                  message={last?.message}
                  error={kakaoVisitorError}
                />
              );
            })()
          )}

          {kakaoPredictionStatus === null ? (
            <div className="admin-batch-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ) : (
            (["KR", "US"] as BatchRegion[]).map((region) => {
              const regionLabel = region === "KR" ? "AI 예측 (한국장)" : "AI 예측 (미국장)";
              const configured = kakaoPredictionStatus.configured;
              const last = kakaoPredictionStatus.last_runs[region] ?? null;
              const isSending = kakaoPredictionRunning === region;
              const tone: OperationTone = isSending ? "running" : !configured ? "neutral" : last ? (last.status === "sent" ? "ok" : "fail") : "neutral";
              const statusLabel = isSending
                ? "발송 중"
                : !configured
                  ? "미설정"
                  : last
                    ? last.status === "sent"
                      ? "성공"
                      : last.status === "error"
                        ? "실패"
                        : "미설정"
                    : "기록 없음";
              const triggeredLabel = last?.triggered_by === "admin" ? "수동" : last?.triggered_by === "auto_delayed" ? "자동(10분 지연)" : null;
              const metaText = !configured
                ? "REST API 키 · 토큰 설정이 필요합니다."
                : last
                  ? `${triggeredLabel ? `${triggeredLabel} · ` : ""}${formatDateTime(last.finished_at)}` + (last.status === "error" && last.error ? ` · ${last.error}` : "")
                  : "아직 실행 이력이 없습니다.";
              return (
                <OperationCard
                  key={region}
                  tone={tone}
                  statusLabel={statusLabel}
                  name={regionLabel}
                  meta={metaText}
                  action={{ label: isSending ? "발송 중..." : "지금 발송", onClick: () => handleRunKakaoPredictionNotify(region), disabled: kakaoPredictionRunning !== null }}
                  message={last?.message}
                  error={kakaoPredictionError}
                />
              );
            })
          )}

          {kakaoDramStatus === null ? (
            <div className="admin-batch-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ) : (
            (() => {
              const configured = kakaoDramStatus.configured;
              const last = kakaoDramStatus.last_run ?? null;
              const isSending = kakaoDramRunning;
              const tone: OperationTone = isSending ? "running" : !configured ? "neutral" : last ? (last.status === "sent" ? "ok" : "fail") : "neutral";
              const statusLabel = isSending
                ? "발송 중"
                : !configured
                  ? "미설정"
                  : last
                    ? last.status === "sent"
                      ? "성공"
                      : last.status === "error"
                        ? "실패"
                        : "미설정"
                    : "기록 없음";
              const triggeredLabel = last?.triggered_by === "admin" ? "수동" : last?.triggered_by === "auto_delayed" ? "자동(10분 지연)" : null;
              const metaText = !configured
                ? "REST API 키 · 토큰 설정이 필요합니다."
                : last
                  ? `${triggeredLabel ? `${triggeredLabel} · ` : ""}${formatDateTime(last.finished_at)}` + (last.status === "error" && last.error ? ` · ${last.error}` : "")
                  : "아직 실행 이력이 없습니다.";
              return (
                <OperationCard
                  tone={tone}
                  statusLabel={statusLabel}
                  name="D램 현물가격"
                  meta={metaText}
                  action={{ label: isSending ? "발송 중..." : "지금 발송", onClick: handleRunKakaoDramNotify, disabled: kakaoDramRunning }}
                  message={last?.message}
                  error={kakaoDramError}
                />
              );
            })()
          )}
        </div>
      </section>
    </div>
  );
}
