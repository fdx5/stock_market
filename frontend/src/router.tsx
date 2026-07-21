import { CSSProperties, MouseEvent, ReactNode, useEffect, useState } from "react";

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): string {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return path;
}

export function Link({
  to,
  className,
  children,
  style,
  "aria-label": ariaLabel,
  title,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  /** For the handful of callers whose link color is computed from data rather than
   * fixed in the stylesheet — an index tile tinted by whether it is up or down. */
  style?: CSSProperties;
  "aria-label"?: string;
  title?: string;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} className={className} style={style} aria-label={ariaLabel} title={title} onClick={handleClick}>
      {children}
    </a>
  );
}
