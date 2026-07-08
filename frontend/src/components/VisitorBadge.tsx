import { useVisitorCount } from "../useVisitorCount";

export default function VisitorBadge() {
  const { current, total } = useVisitorCount();
  return (
    <span className="visitor-badge">
      <span className="visitor-badge-dot" />
      현재 접속자 {current === null ? "-" : current.toLocaleString()}명
      <span className="visitor-badge-sep">·</span>
      누적 방문 {total === null ? "-" : total.toLocaleString()}명
    </span>
  );
}
