import { useVisitorCount } from "../useVisitorCount";

export default function VisitorBadge() {
  const count = useVisitorCount();
  return (
    <span className="visitor-badge">
      <span className="visitor-badge-dot" />
      현재 접속자 {count === null ? "-" : count.toLocaleString()}명
    </span>
  );
}
