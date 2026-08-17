import { ReactNode } from "react";

export type OperationTone = "ok" | "fail" | "running" | "neutral" | "idle";

interface OperationCardProps {
  tone: OperationTone;
  statusLabel: string;
  name: string;
  meta: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Source badges, warning lists, subscribed-stock chips — whatever a card needs
   * below its main row. Kept as a slot rather than a fixed shape because each
   * operation (AI 예측/메일/카카오) has its own idea of "detail". */
  detail?: ReactNode;
  message?: string | null;
  error?: string | null;
}

/** One "상태 + 이름 + 메타 + 실행 버튼" row, styled consistently for every
 * operation on the 운영 탭 (AI 예측 배치, D램 배치, 예측 메일, 카카오 알림) —
 * previously each of these hand-rolled the same markup with small drifts. Reuses
 * the existing `.admin-batch-*` classes rather than introducing a parallel set. */
export default function OperationCard({ tone, statusLabel, name, meta, action, detail, message, error }: OperationCardProps) {
  return (
    <div className="admin-batch-item">
      <div className="admin-batch-row">
        <span className={`admin-batch-status admin-batch-status--${tone}`}>{statusLabel}</span>
        <span className="admin-batch-name">{name}</span>
        <span className="admin-batch-meta">{meta}</span>
        {action && (
          <button type="button" className="admin-batch-run-btn" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      {detail}
      {message && <pre className="admin-notify-message">{message}</pre>}
      {error && <p className="admin-batch-error">{error}</p>}
    </div>
  );
}
