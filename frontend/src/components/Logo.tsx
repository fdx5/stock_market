import { useThemeMode } from "../theme";

export default function Logo({ className }: { className: string }) {
  const mode = useThemeMode();
  const src = mode === "light" ? "/img/kstock-logo-light.png" : "/img/kstock-logo.png";
  return <img src={src} alt="K-Stock Hub" className={className} />;
}
