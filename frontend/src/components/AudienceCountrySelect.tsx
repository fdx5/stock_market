import { useEffect, useId, useRef, useState } from "react";

const names = new Intl.DisplayNames(["ko"], { type: "region" });
export function audienceCountryName(code: string) {
  if (!code) return "전체";
  if (code === "unknown") return "국가 미확인";
  try { return names.of(code) || code; } catch { return code; }
}

export function AudienceCountryFlag({ country }: { country: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [country]);
  return /^[A-Z]{2}$/.test(country) && !failed
    ? <img className="aa-country-flag" src={`https://flagcdn.com/${country.toLowerCase()}.svg`} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="aa-country-flag" aria-hidden="true">{country ? "◌" : "🌐"}</span>;
}

/** Image options keep flags visible on Windows, whose native emoji font lacks flags. */
export default function AudienceCountrySelect({ value, countries, onChange }: {
  value: string; countries: string[]; onChange: (value: string) => void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const codes = ["", ...Array.from(new Set([...countries, ...(value ? [value] : [])]))
    .filter(Boolean).sort((a, b) => audienceCountryName(a).localeCompare(audienceCountryName(b), "ko"))];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const choose = (code: string) => { onChange(code); setOpen(false); trigger.current?.focus(); };
  return <div className="aa-country-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <span id={`${id}-label`}>조회 국가</span>
    <button ref={trigger} type="button" role="combobox" aria-labelledby={`${id}-label ${id}-value`}
      aria-controls={`${id}-list`} aria-expanded={open} aria-haspopup="listbox"
      aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => { setActive(Math.max(0, codes.indexOf(value))); setOpen(v => !v); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); setOpen(true);
          setActive(index => event.key === "Home" ? 0 : event.key === "End" ? codes.length - 1
            : Math.max(0, Math.min(codes.length - 1, (open ? index : Math.max(0, codes.indexOf(value))) + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (open && ["Enter", " "].includes(event.key)) { event.preventDefault(); choose(codes[active]); }
        else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        else if (event.key === "Tab") setOpen(false);
      }}>
      <AudienceCountryFlag country={value}/><span id={`${id}-value`}>{audienceCountryName(value)}</span><span aria-hidden="true">▾</span>
    </button>
    {open && <div id={`${id}-list`} className="aa-country-options" role="listbox" aria-labelledby={`${id}-label`}>
      {codes.map((code, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${index}`} key={code}
        aria-selected={value === code} className={active === index ? "is-active" : ""}
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(code)}>
        <AudienceCountryFlag country={code}/><span>{audienceCountryName(code)}</span>{value === code && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}
