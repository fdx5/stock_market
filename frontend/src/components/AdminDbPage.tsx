import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminAuthError,
  DbCell,
  DbColumn,
  DbQueryResult,
  DbSource,
  DbTable,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { Link, navigate } from "../router";
import { useBodyScrollLock } from "../useBodyScrollLock";
import { useDocumentTitle } from "../useDocumentTitle";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

const ROW_LIMITS = [50, 200, 500, 1000, 2000];
const DEFAULT_LIMIT = 200;

const numberFormat = new Intl.NumberFormat("ko-KR");

function formatCount(n: number | null): string {
  return n === null ? "-" : numberFormat.format(n);
}

/** Cells are rendered as text, but NULL has to stay distinguishable from the empty
 * string and from the literal text "NULL" — hence the separate flag rather than a
 * sentinel string the grid would have no way to tell apart from real data. */
function cellText(value: DbCell): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function isBlank(value: DbCell): boolean {
  return value === null || value === "";
}

/** Pretty-prints a value that turns out to be JSON, so the detail popup shows structure
 * instead of one unreadable line. Anything that doesn't parse is shown as-is. */
function prettyValue(value: DbCell): string {
  const text = cellText(value);
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

/** CSV for Excel.
 *
 * Two things beyond quoting: a UTF-8 BOM, without which Excel reads Korean text as
 * mojibake, and a leading apostrophe on anything starting with = + - @, which Excel
 * would otherwise evaluate as a formula. The values here come out of the database, so
 * a cell reading "=cmd|..." is exactly the case that guard exists for.
 */
function toCsv(columns: string[], rows: DbCell[][]): string {
  const escape = (value: DbCell): string => {
    if (value === null) return "";
    let text = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map((c) => escape(c)).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return `﻿${lines.join("\r\n")}`;
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}`;
}

/** Full contents of one cell, opened by double-clicking it in the grid — the grid
 * itself keeps rows one line tall, so a long JSON blob or a stack trace is otherwise
 * only ever visible as its first few characters. */
function CellDetailModal({
  column,
  value,
  rowNumber,
  onClose,
}: {
  column: string;
  value: DbCell;
  rowNumber: number;
  onClose: () => void;
}) {
  useBodyScrollLock(true);
  const [copied, setCopied] = useState(false);
  const text = cellText(value);
  const pretty = prettyValue(value);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="admin-db-modal-backdrop" onClick={onClose}>
      <div className="admin-db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-db-modal-head">
          <div>
            <div className="admin-db-modal-col">{column}</div>
            <div className="admin-db-modal-meta">
              {rowNumber}번째 행 · {value === null ? "NULL" : `${numberFormat.format(text.length)}자`}
              {typeof value === "number" && " · 숫자"}
            </div>
          </div>
          <div className="admin-db-modal-actions">
            <button type="button" className="admin-db-btn" onClick={handleCopy} disabled={value === null}>
              {copied ? "복사됨" : "복사"}
            </button>
            <button type="button" className="admin-db-modal-close" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>
        </div>
        <pre className={`admin-db-modal-body${value === null ? " admin-db-modal-body--null" : ""}`}>
          {value === null ? "NULL" : pretty}
        </pre>
      </div>
    </div>
  );
}

export default function AdminDbPage() {
  useDocumentTitle("DB 조회 | K-Stock Hub");

  // Same gate as AdminDashboardPage: the page is only ever reached from the admin
  // dashboard, and a direct URL hit without a session bounces to the login screen
  // before anything renders. The API behind it is independently admin-only, so this
  // is the convenience half of the guard, not the enforcing half.
  const [authed] = useState(() => !!getStoredSession());
  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  const [sources, setSources] = useState<DbSource[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<DbColumn[] | null>(null);

  const [sql, setSql] = useState("");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [resultTable, setResultTable] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<{ column: string; value: DbCell; rowNumber: number } | null>(
    null
  );

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const handleAuthError = useCallback((err: unknown) => {
    if (err instanceof AdminAuthError) {
      clearStoredSession();
      navigate("/admin");
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .dbSources()
      .then((data) => {
        if (cancelled) return;
        setSources(data.sources);
        setSource((current) => current ?? data.sources[0]?.id ?? null);
      })
      .catch((err) => {
        if (cancelled || handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "데이터베이스 목록을 불러오지 못했습니다.");
        setTablesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handleAuthError]);

  const loadTables = useCallback(() => {
    if (!source) return;
    setTablesLoading(true);
    adminApi
      .dbTables(source)
      .then((data) => {
        setTables(data.tables);
        setTablesLoading(false);
      })
      .catch((err) => {
        if (handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "테이블 목록을 불러오지 못했습니다.");
        setTablesLoading(false);
      });
  }, [source, handleAuthError]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  function selectTable(table: DbTable) {
    setSelectedTable(table.name);
    setColumns(null);
    adminApi
      .dbColumns(table.name, source)
      .then((data) => setColumns(data.columns))
      .catch((err) => {
        if (!handleAuthError(err)) setColumns([]);
      });
  }

  /** Double-click: run the server-built newest-first query and drop its SQL into the
   * editor, so the default is both immediate and a starting point to edit. */
  function previewTable(table: DbTable) {
    setSelectedTable(table.name);
    setRunning(true);
    setError(null);
    adminApi
      .dbPreview(table.name, source, limit)
      .then((data) => {
        setResult(data);
        setResultTable(table.name);
        setSql(data.sql);
        setRunning(false);
      })
      .catch((err) => {
        if (handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "조회에 실패했습니다.");
        setRunning(false);
        setResult(null);
      });
  }

  function runQuery() {
    if (!sql.trim() || running) return;
    setRunning(true);
    setError(null);
    adminApi
      .dbQuery(sql, source, limit)
      .then((data) => {
        setResult(data);
        setResultTable(null);
        setRunning(false);
      })
      .catch((err) => {
        if (handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "조회에 실패했습니다.");
        setRunning(false);
        setResult(null);
      });
  }

  function handleEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
  }

  function handleDownload() {
    if (!result || result.rows.length === 0) return;
    // Named after the table only when the grid is actually showing that table's preview.
    // A hand-written query is named "query": the table still selected in the sidebar is
    // not necessarily the one the query read, and a file named after the wrong table is
    // worse than a generic name.
    const base = resultTable ?? "query";
    downloadCsv(`${base}_${timestampSuffix()}.csv`, toCsv(result.columns, result.rows));
  }

  const filteredTables = useMemo(() => {
    const needle = tableFilter.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tables, tableFilter]);

  const totalRows = useMemo(
    () => tables.reduce((sum, t) => sum + (t.rows ?? 0), 0),
    [tables]
  );

  // When the grid is showing a table preview, the table's own row count is what tells
  // the reader whether these 200 rows are the whole table or the newest slice of it.
  const previewTotal = resultTable
    ? tables.find((t) => t.name === resultTable)?.rows ?? null
    : null;

  if (!authed) return null;

  return (
    <div className="admin-db-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/hub" className="app-brand" aria-label="K-Stock Hub 태양계 홈">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <header className="admin-db-header">
        <div>
          <h1 className="admin-db-title">
            <span className="admin-db-title-icon">🗄</span> DB 조회
          </h1>
          <p className="admin-db-subtitle">
            조회 전용 콘솔 · 테이블 {formatCount(tables.length)}개 · 전체 {formatCount(totalRows)}행
            {sources.length > 0 && (
              <span className="admin-db-source-tag">
                {sources.find((s) => s.id === source)?.label ?? source}
              </span>
            )}
          </p>
        </div>
        <div className="admin-db-header-actions">
          {sources.length > 1 && (
            <select
              className="admin-db-select"
              value={source ?? ""}
              onChange={(e) => {
                setSource(e.target.value);
                setSelectedTable(null);
                setColumns(null);
                setResult(null);
              }}
              aria-label="데이터베이스 선택"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="admin-db-btn" onClick={() => navigate("/admin/dashboard")}>
            ← 대시보드
          </button>
          <button
            type="button"
            className="admin-logout-btn"
            onClick={() => {
              clearStoredSession();
              navigate("/admin");
            }}
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="admin-db-layout">
        <aside className="admin-db-sidebar">
          <div className="admin-db-sidebar-head">
            <h2>테이블</h2>
            <button
              type="button"
              className="admin-db-icon-btn"
              onClick={loadTables}
              title="목록 새로고침"
              aria-label="목록 새로고침"
            >
              ⟳
            </button>
          </div>
          <input
            className="admin-db-filter"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="테이블 검색"
            aria-label="테이블 검색"
          />
          <p className="admin-db-hint">테이블을 더블클릭하면 최신순으로 조회합니다.</p>

          <div className="admin-db-table-list">
            {tablesLoading ? (
              <div className="admin-db-empty">불러오는 중...</div>
            ) : filteredTables.length === 0 ? (
              <div className="admin-db-empty">
                {tables.length === 0 ? "테이블이 없습니다." : "검색 결과가 없습니다."}
              </div>
            ) : (
              filteredTables.map((table) => (
                <div key={table.name}>
                  <button
                    type="button"
                    className={`admin-db-table-item${
                      selectedTable === table.name ? " admin-db-table-item--active" : ""
                    }`}
                    onClick={() => selectTable(table)}
                    onDoubleClick={() => previewTable(table)}
                    title={`${table.name} — 더블클릭하면 조회합니다`}
                  >
                    <span className={`admin-db-type admin-db-type--${table.type}`}>
                      {table.type === "view" ? "V" : "T"}
                    </span>
                    <span className="admin-db-table-name">{table.name}</span>
                    <span className="admin-db-table-rows">{formatCount(table.rows)}</span>
                  </button>
                  {selectedTable === table.name && columns && (
                    <ul className="admin-db-column-list">
                      {columns.map((col) => (
                        <li key={col.name}>
                          <span className="admin-db-column-name">
                            {col.primary_key && <span className="admin-db-pk" title="기본키">PK</span>}
                            {col.name}
                          </span>
                          <span className="admin-db-column-type">{col.type || "?"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="admin-db-main">
          <section className="admin-db-editor-panel">
            <div className="admin-db-editor-head">
              <h2>SQL 조회</h2>
              <div className="admin-db-editor-actions">
                <label className="admin-db-limit">
                  최대
                  <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    aria-label="최대 행 수"
                  >
                    {ROW_LIMITS.map((n) => (
                      <option key={n} value={n}>
                        {numberFormat.format(n)}행
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="admin-db-btn"
                  onClick={() => {
                    setSql("");
                    editorRef.current?.focus();
                  }}
                  disabled={!sql}
                >
                  지우기
                </button>
                <button
                  type="button"
                  className="admin-db-run-btn"
                  onClick={runQuery}
                  disabled={running || !sql.trim()}
                >
                  {running ? "조회 중..." : "▶ 조회"}
                </button>
              </div>
            </div>
            <textarea
              ref={editorRef}
              className="admin-db-editor"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              spellCheck={false}
              placeholder={'SELECT * FROM page_views ORDER BY id DESC LIMIT 100;\n\nCtrl+Enter 로 실행'}
            />
            <p className="admin-db-editor-note">
              조회 전용입니다 — SELECT 문만 실행되며, 데이터를 변경하는 구문은 차단됩니다.
            </p>
          </section>

          <section className="admin-db-result-panel">
            <div className="admin-db-result-head">
              <div className="admin-db-result-meta">
                {error ? (
                  <span className="admin-db-error">{error}</span>
                ) : result ? (
                  <>
                    <strong>{formatCount(result.row_count)}행</strong>
                    <span className="admin-db-result-sep">·</span>
                    <span>{result.columns.length}개 컬럼</span>
                    <span className="admin-db-result-sep">·</span>
                    <span>{numberFormat.format(Math.round(result.elapsed_ms))}ms</span>
                    {previewTotal !== null && previewTotal > result.row_count && (
                      <span className="admin-db-badge">
                        전체 {formatCount(previewTotal)}행 중 최신 {formatCount(result.row_count)}행
                      </span>
                    )}
                    {result.truncated && (
                      <span className="admin-db-badge admin-db-badge--warn">
                        {formatCount(result.limit)}행에서 잘림
                      </span>
                    )}
                  </>
                ) : (
                  <span className="admin-db-muted">
                    왼쪽에서 테이블을 더블클릭하거나 SQL을 입력해 조회하세요.
                  </span>
                )}
              </div>
              <button
                type="button"
                className="admin-db-btn admin-db-btn--excel"
                onClick={handleDownload}
                disabled={!result || result.rows.length === 0}
                title="현재 조회 결과를 엑셀에서 열 수 있는 CSV로 저장합니다"
              >
                ⤓ 엑셀 다운로드
              </button>
            </div>

            <div className="admin-db-grid-wrap">
              {running ? (
                <div className="admin-db-empty admin-db-empty--grid">조회 중...</div>
              ) : !result ? (
                <div className="admin-db-empty admin-db-empty--grid">조회 결과가 여기에 표시됩니다.</div>
              ) : result.rows.length === 0 ? (
                <div className="admin-db-empty admin-db-empty--grid">조회된 행이 없습니다.</div>
              ) : (
                <table className="admin-db-grid">
                  <thead>
                    <tr>
                      <th className="admin-db-grid-num">#</th>
                      {result.columns.map((col, i) => (
                        <th key={`${col}-${i}`} title={col}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <td className="admin-db-grid-num">{rowIndex + 1}</td>
                        {row.map((value, colIndex) => (
                          <td
                            key={colIndex}
                            className={
                              typeof value === "number"
                                ? "admin-db-cell admin-db-cell--num"
                                : isBlank(value)
                                  ? "admin-db-cell admin-db-cell--null"
                                  : "admin-db-cell"
                            }
                            onDoubleClick={() =>
                              setDetail({
                                column: result.columns[colIndex] ?? `col${colIndex + 1}`,
                                value,
                                rowNumber: rowIndex + 1,
                              })
                            }
                            title="더블클릭하면 전체 내용을 봅니다"
                          >
                            {value === null ? (
                              <span className="admin-db-null">NULL</span>
                            ) : value === "" ? (
                              <span className="admin-db-null">(빈 값)</span>
                            ) : (
                              cellText(value)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </main>
      </div>

      {detail && (
        <CellDetailModal
          column={detail.column}
          value={detail.value}
          rowNumber={detail.rowNumber}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
