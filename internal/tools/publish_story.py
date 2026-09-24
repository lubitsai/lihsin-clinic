#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_story.py — 「停止掛號」公告：FB／IG 限時動態發布與撤除

院長 2026-09-14 裁示的範圍裡，**只有 FB／IG 限動這半可以自動化**；
LINE 自動回應訊息沒有公開管理 API，仍由院長在後台手動開關
（見 `internal/社群_停止掛號公告_素材與自動化規劃_20260914.md` §3）。
**所以跑完本腳本不等於公告發完了——LINE 那則要另外手動開。**

用法：
  publish_story.py publish  --session morning|afternoon|evening|dr-tsai [--dry-run]
  publish_story.py teardown [--force] [--dry-run]
  publish_story.py status

環境變數（GitHub Secrets 注入，⛔ 不得寫進任何 commit）：
  META_PAGE_ID       立欣診所 FB 粉專的 Page ID
  META_PAGE_TOKEN    Page access token（建議用 system user token，不會 60 天過期）
  META_IG_USER_ID    綁在該粉專底下的 IG 商業帳號 ID
  META_API_VERSION   選填，預設 v21.0

撤除時刻**不寫死**，一律由 `index.html` 的 `SCHEDULE`／`EXCEPTIONS` 推導
（解析沿用 `sync_schedule.py`，不另寫第二份）。規則只有一條：

    撤除時刻 = min(該診次結束時間, 下一個有診次的現場掛號受理時間 − 5 分鐘)

這條規則自己會長出整張表，不必手動維護：
  平日早診 end 12:00、下一診午診收號 14:30 → 12:00
  平日午診 end 18:00、下一診晚診收號 18:00 → **17:55**（兩者零空檔，必須提早）
  週六午診 end 18:00、當天無晚診           → 18:00（不必提早）
  平日晚診 end 21:30、當天無下一診          → 21:30
  週日早診 end 11:30、下一診晚診收號 18:00 → 11:30
⚠️ 改門診時間（情境 B）或當天有 `EXCEPTIONS`（颱風、醫師進修）都會自動跟著變。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_schedule import (  # noqa: E402  沿用同一份班表解析，不另寫第二份
    ScheduleError,
    parse_js_exceptions,
    parse_js_schedule,
)

TW = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX = os.path.join(ROOT, "index.html")
STATE_PATH = os.path.join(ROOT, "internal", "social-state.json")
SITE = "https://lhpedclinic.com.tw"

# 現場掛號受理時間。⚠️ 這**不在** SCHEDULE 裡——SCHEDULE 存的是「看診」時間
# （晚診 18:30 起），掛號受理是另一組數字（晚診 18:00 起）。
# 口徑來源：internal/archive/AI客服知識庫_現場掛號時間問答稿_20260809.md（院長 2026-08-09 給定）。
REGISTRATION_OPEN = {"MORNING": "08:00", "AFTERNOON": "14:30", "EVENING": "18:00"}
LEAD_MINUTES = 5  # 與下一診次掛號時間撞在一起時，提早幾分鐘撤

# 公告種類 → 圖檔主幹。醫師別那張刻意沒有日夜兩版（院長 2026-09-14 裁示），
# 週日早診與週一晚診共用同一張。
NOTICES = {
    "morning": {"slug": "registration-closed-morning", "session": "MORNING"},
    "afternoon": {"slug": "registration-closed-afternoon", "session": "AFTERNOON"},
    "evening": {"slug": "registration-closed-evening", "session": "EVENING"},
    # 醫師別停掛：診次由星期決定（全週只有這兩診是兩位醫師同時看診）
    "dr-tsai": {"slug": "registration-closed-dr-tsai", "session": {0: "MORNING", 1: "EVENING"}},
}
SESSION_LABEL = {"MORNING": "早診", "AFTERNOON": "午診", "EVENING": "晚診"}


class PublishError(RuntimeError):
    pass


# ---------------------------------------------------------------- 時間推導


def _hhmm_to_min(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def slots_for(now: datetime) -> list[dict]:
    """當天的診次表：有單日特例就用特例，否則用週班表。"""
    html = open(INDEX, encoding="utf-8").read()
    exceptions = parse_js_exceptions(html)
    key = now.strftime("%Y-%m-%d")
    if key in exceptions:
        return exceptions[key]
    # %w ＝ 0=日…6=六，與 SCHEDULE 的鍵、JS Date.getDay() 一致
    # （刻意不用 datetime.weekday()，那是 0=一…6=日，差一天）
    return parse_js_schedule(html)[int(now.strftime("%w"))]


def resolve_session(kind: str, now: datetime) -> str:
    spec = NOTICES[kind]["session"]
    if isinstance(spec, str):
        return spec
    weekday = int(now.strftime("%w"))  # 0=日…6=六，與 SCHEDULE 一致
    if weekday not in spec:
        raise PublishError(
            f"醫師別停掛只適用於週日早診與週一晚診（全週僅有的兩位醫師同時看診時段），"
            f"今天是週{'日一二三四五六'[weekday]}。要發整診停掛請改用 "
            f"--session morning/afternoon/evening。"
        )
    return spec[weekday]


def teardown_time(session: str, now: datetime) -> datetime:
    """撤除時刻 = min(該診次結束, 下一個有診次的掛號受理時間 − LEAD_MINUTES)。"""
    slots = slots_for(now)
    by_session = {s["session"]: s for s in slots}
    if session not in by_session:
        raise PublishError(
            f"今天（{now:%Y-%m-%d}，週{'日一二三四五六'[int(now.strftime('%w'))]}）"
            f"沒有{SESSION_LABEL[session]}——依 index.html 的班表／單日特例。"
        )
    end_min = _hhmm_to_min(by_session[session]["end"])

    order = ["MORNING", "AFTERNOON", "EVENING"]
    later = [s for s in order[order.index(session) + 1 :] if s in by_session]
    if later:
        nxt = _hhmm_to_min(REGISTRATION_OPEN[later[0]]) - LEAD_MINUTES
        end_min = min(end_min, nxt)

    return now.replace(hour=end_min // 60, minute=end_min % 60, second=0, microsecond=0)


# ---------------------------------------------------------------- 狀態


def load_state() -> dict:
    if not os.path.exists(STATE_PATH):
        return {"active": None}
    with open(STATE_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


# ---------------------------------------------------------------- Meta API


def _graph(path: str, params: dict, method: str = "POST", dry: bool = False):
    version = os.environ.get("META_API_VERSION", "v21.0")
    url = f"https://graph.facebook.com/{version}/{path}"
    token = os.environ.get("META_PAGE_TOKEN", "")
    if dry:
        shown = {k: v for k, v in params.items()}
        print(f"    [dry-run] {method} {url}  {shown}")
        return {"id": f"DRYRUN_{path.replace('/', '_')}"}
    if not token:
        raise PublishError("缺少環境變數 META_PAGE_TOKEN")
    body = urllib.parse.urlencode({**params, "access_token": token}).encode()
    if method == "POST":
        req = urllib.request.Request(url, data=body, method="POST")
    else:
        req = urllib.request.Request(f"{url}?{body.decode()}", method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:600]
        raise PublishError(f"Graph API {method} {path} 回 {exc.code}：{detail}") from exc


def check_image_reachable(url: str) -> None:
    """IG 要求圖片是公開 URL。先自己確認一次，否則 IG 只會回一個難解的錯誤。"""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as r:
            if r.status != 200:
                raise PublishError(f"圖片 URL 回 HTTP {r.status}：{url}")
    except urllib.error.HTTPError as exc:
        raise PublishError(f"圖片 URL 回 HTTP {exc.code}：{url}") from exc
    except OSError as exc:
        # 本機 egress 可能擋掉本站網域；GitHub runner 不會。這裡只警告、不擋。
        print(f"  ⚠️ 無法從本機確認圖片 URL（{exc}）——若在 CI 上出現這行才需要處理。")


def publish_fb(image_url: str, dry: bool) -> str:
    page = os.environ.get("META_PAGE_ID", "") or ("DRYRUN_PAGE" if dry else "")
    if not page:
        raise PublishError("缺少環境變數 META_PAGE_ID")
    # 兩段式：先上傳未發布的照片拿 photo_id，再用它建限動。
    # 每次都重新上傳＝每次都是新的 photo_id，避開 Meta「素材不得重複使用」的限制。
    photo = _graph(f"{page}/photos", {"url": image_url, "published": "false"}, dry=dry)
    story = _graph(f"{page}/photo_stories", {"photo_id": photo["id"]}, dry=dry)
    return str(story.get("post_id") or story.get("id") or photo["id"])


def publish_ig(image_url: str, dry: bool) -> str:
    ig = os.environ.get("META_IG_USER_ID", "") or ("DRYRUN_IG" if dry else "")
    if not ig:
        raise PublishError("缺少環境變數 META_IG_USER_ID")
    container = _graph(f"{ig}/media", {"image_url": image_url, "media_type": "STORIES"}, dry=dry)
    if not dry:
        time.sleep(5)  # 容器要一點時間轉好，太快 publish 會被打回
    published = _graph(f"{ig}/media_publish", {"creation_id": container["id"]}, dry=dry)
    return str(published["id"])


def delete_media(media_id: str, label: str, dry: bool) -> bool:
    try:
        _graph(media_id, {}, method="DELETE", dry=dry)
        print(f"  ✓ {label} 已刪除（{media_id}）")
        return True
    except PublishError as exc:
        # FB 限動的刪除端點未經一手文件查證（規劃檔 §4-1 已標）。
        # 刪不掉不是災難——限動 24 小時本來就會自己消失——所以只警告、不讓整批失敗。
        print(f"  ⚠️ {label} 刪除失敗，改由 24 小時自動過期收尾：{exc}")
        return False


# ---------------------------------------------------------------- 指令


def cmd_publish(args) -> int:
    now = datetime.now(TW)
    state = load_state()
    if state.get("active") and not args.force:
        a = state["active"]
        raise PublishError(
            f"已經有一則在線上（{a['kind']}，{a['published_at']}，"
            f"預定 {a['teardown_at']} 撤除）。先跑 teardown，或加 --force 覆蓋。"
        )

    session = resolve_session(args.session, now)
    tear = teardown_time(session, now)
    if now >= tear:
        raise PublishError(
            f"現在 {now:%H:%M} 已經過了{SESSION_LABEL[session]}的撤除時刻 {tear:%H:%M}，不發。"
        )

    slug = NOTICES[args.session]["slug"]
    # 加時間戳查詢字串：Netlify 照樣回同一個檔，但對 Meta 而言是不同的 URL，
    # 避開「同一素材不得重複發布」的可能判定。
    image_url = f"{SITE}/images/social/{slug}-story.jpg?v={int(now.timestamp())}"

    print(f"發布：{args.session}（{SESSION_LABEL[session]}）")
    print(f"  圖片：{image_url}")
    print(f"  撤除時刻：{tear:%Y-%m-%d %H:%M}（+08:00）")
    check_image_reachable(image_url)

    fb_id = publish_fb(image_url, args.dry_run)
    print(f"  ✓ FB 限動：{fb_id}")
    ig_id = publish_ig(image_url, args.dry_run)
    print(f"  ✓ IG 限動：{ig_id}")

    if args.dry_run:
        print("\n[dry-run] 未實際發布、未寫入狀態檔。")
        return 0

    save_state(
        {
            "active": {
                "kind": args.session,
                "session": session,
                "date": now.strftime("%Y-%m-%d"),
                "published_at": now.isoformat(timespec="seconds"),
                "teardown_at": tear.isoformat(timespec="seconds"),
                "fb_story_id": fb_id,
                "ig_media_id": ig_id,
            }
        }
    )
    print("\n⚠️ 這只完成了 FB／IG 兩個載體。")
    print("⚠️ LINE 自動回應訊息要另外到後台手動開啟——那是觸及 6,653 位好友的那一個。")
    return 0


def cmd_teardown(args) -> int:
    state = load_state()
    active = state.get("active")
    if not active:
        print("目前沒有在線上的限動，不需要撤除。")
        return 0

    now = datetime.now(TW)
    tear = datetime.fromisoformat(active["teardown_at"])
    if now < tear and not args.force:
        print(f"還沒到撤除時刻（現在 {now:%H:%M}，預定 {tear:%H:%M}），不動作。")
        return 0

    print(f"撤除：{active['kind']}（{active['date']}，預定 {tear:%H:%M}）")
    delete_media(active["ig_media_id"], "IG 限動", args.dry_run)
    delete_media(active["fb_story_id"], "FB 限動", args.dry_run)

    if args.dry_run:
        print("\n[dry-run] 未實際刪除、未清除狀態檔。")
        return 0

    save_state({"active": None})
    print("\n⚠️ LINE 自動回應訊息要另外到後台手動關閉。")
    print("⚠️ 那是唯一不會自己消失的載體——不關就會一直錯下去。")
    return 0


def cmd_status(args) -> int:
    state = load_state()
    active = state.get("active")
    if not active:
        print("目前沒有在線上的限動。")
        return 0
    now = datetime.now(TW)
    tear = datetime.fromisoformat(active["teardown_at"])
    due = "⏰ 已到撤除時刻" if now >= tear else f"還有 {int((tear - now).total_seconds() // 60)} 分鐘"
    print(f"在線上：{active['kind']}（{SESSION_LABEL[active['session']]}）")
    print(f"  發布於 {active['published_at']}")
    print(f"  撤除時刻 {active['teardown_at']}　{due}")
    print(f"  FB {active['fb_story_id']}　IG {active['ig_media_id']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="「停止掛號」公告：FB／IG 限動發布與撤除")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("publish", help="發布 FB＋IG 限動")
    p.add_argument("--session", required=True, choices=sorted(NOTICES))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="已有在線上的限動時仍強制發布")
    p.set_defaults(func=cmd_publish)

    t = sub.add_parser("teardown", help="撤除（時刻未到時不動作）")
    t.add_argument("--dry-run", action="store_true")
    t.add_argument("--force", action="store_true", help="不管時刻、立刻撤除")
    t.set_defaults(func=cmd_teardown)

    s = sub.add_parser("status", help="印出目前狀態")
    s.set_defaults(func=cmd_status)

    args = ap.parse_args()
    try:
        return args.func(args)
    except (PublishError, ScheduleError) as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
