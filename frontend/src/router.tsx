import { MouseEvent, ReactNode, useEffect, useState } from "react";

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
  "aria-label": ariaLabel,
  title,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} className={className} aria-label={ariaLabel} title={title} onClick={handleClick}>
      {children}
    </a>
  );
}
