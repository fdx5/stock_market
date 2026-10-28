import { useEffect, useState } from "react";
import { api, type StockValuation } from "../../api/client";

/** Financial ratios load independently so they never hold up price or chart feeds. */
export function useStockValuation(code: string, isEtf: boolean, revision = 0) {
  const normalizedCode = code.trim().toUpperCase();
  const [value, setValue] = useState<StockValuation | null>(null);
  useEffect(() => {
    setValue(null);
    if (isEtf) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const us = !/^\d[0-9A-Z]{5}$/.test(normalizedCode);
    api.stockValuation(normalizedCode, us, controller.signal)
      .then(result => { if (!controller.signal.aborted) setValue(result); })
      .catch(() => {})
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [normalizedCode, isEtf, revision]);
  return !isEtf && value?.code === normalizedCode ? value : null;
}
