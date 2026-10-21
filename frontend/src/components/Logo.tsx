import { useThemeMode } from "../theme";
import { useDesignMode } from "../neo/settings";
import NeoLogo from "../neo/NeoLogo";

export default function Logo({ className }: { className: string }) {
  const mode = useThemeMode();
  const design = useDesignMode();
  if (design === "neo") return <NeoLogo className={className} />;
  const src = mode === "light" ? "/img/kstock-logo-light.webp" : "/img/kstock-logo.webp";
  return <img src={src} alt="K-Stock Hub" className={className} />;
}
