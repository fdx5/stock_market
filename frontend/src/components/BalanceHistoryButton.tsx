import { useEffect, useState } from "react";
import { BalanceHistory, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import BalanceHistoryModal from "./BalanceHistoryModal";

/* The 공매도 수급 entry point, sitting to the right of the 호가 잔량 bar in the stock
   header — the two belong together: one says what the order book looks like right
   now, the other what short sellers have been doing across sessions.

   It loads the history up front rather than on click, for two reasons. It is the
   only way to know whether to render at all — a stock with no published 공매도 gets
   no button, which is better than a control that opens an empty panel — and it means
   the modal's table is filled on its first frame instead of showing a spinner over
   data the button already had to have.

   Cheap enough to do that: the backend caches this per stock for an hour (the figure
   is published once a session), so this is a warm hit for everyone after the first
   visitor, and it is skipped entirely on the reduced-motion-irrelevant path of a
   stock that has never had any. */
export default function BalanceHistoryButton({ code, name }: { code: string; name: string }) {
  const t = useT();
  const [history, setHistory] = useState<BalanceHistory | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Close whatever was open and drop the previous stock's rows — this component
    // stays mounted as the dashboard switches stocks, and showing 삼성전자's 공매도
    // under SK하이닉스's name for a frame would be worse than showing nothing.
    setHistory(null);
    setOpen(false);

    api
      .balanceHistory(code)
      .then((res) => {
        if (!cancelled) setHistory(res);
      })
      .catch(() => {
        // Stays hidden. This is a secondary readout in a header that already carries
        // the price, the badges and the depth bar; an error row for it would cost
        // more attention than the panel is worth.
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!history || history.items.length === 0) return null;

  return (
    <>
      {/* Named for what it opens rather than "더보기": the header has several things a
          reader could be asked to open, and the label is the only thing distinguishing
          them. One name for the panel, not the series list joined — five labels don't
          fit on a button sharing its row with the depth bar. */}
      <button type="button" className="balance-open" onClick={() => setOpen(true)}>
        {t("공매도 수급")}
        <span className="balance-open-caret" aria-hidden="true">
          ›
        </span>
      </button>
      {open && <BalanceHistoryModal history={history} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
