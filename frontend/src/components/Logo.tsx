import { useThemeMode } from "../theme";

export default function Logo({ className }: { className: string }) {
  const mode = useThemeMode();
  const src = mode === "light" ? "/img/kstock-logo-light.webp" : "/img/kstock-logo.webp";
  return <img src={src} alt="K-Stock Hub" className={className} />;
}
