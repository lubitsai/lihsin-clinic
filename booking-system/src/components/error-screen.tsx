"use client";

import Link from "next/link";
import { DeerMascot } from "@/components/ui";

/**
 * 「找不到網頁」與「系統錯誤」共用的畫面（前台與後台各自帶入文字）。
 *
 * 沒有這些頁時，Next.js 會顯示內建的英文頁（404 This page could not be found.／
 * Application error），家長看不懂、也不知道下一步——院長 2026-10-17 指示改成中文。
 * 前台文字列於 docs/08 §七之六，改動需院長逐字核可。
 *
 * 錯誤細節（error.message）一律不顯示：正式環境本來就會遮蔽，且可能含內部資訊；
 * 只顯示 digest 代碼，家長截圖傳給櫃檯時，工程端可據以對照伺服器日誌。
 */
export function ErrorScreen({
  title,
  children,
  onRetry,
  homeHref,
  homeLabel,
  digest,
}: {
  title: string;
  children: React.ReactNode;
  /** 有給就顯示「再試一次」為主要按鈕，回首頁退為次要 */
  onRetry?: () => void;
  homeHref: string;
  homeLabel: string;
  digest?: string;
}) {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md text-center space-y-4">
        <div className="flex justify-center">
          <DeerMascot size={72} />
        </div>
        <h1 className="text-2xl font-bold text-sage-700">{title}</h1>
        <div className="text-ink-700 leading-relaxed">{children}</div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-primary">
              再試一次
            </button>
          )}
          <Link href={homeHref} className={onRetry ? "btn-secondary" : "btn-primary"}>
            {homeLabel}
          </Link>
        </div>
        {digest && <p className="text-xs text-ink-500 pt-2">錯誤代碼：{digest}</p>}
      </div>
    </main>
  );
}
