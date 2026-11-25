#!/usr/bin/env python3
"""Google 商家檔案（GBP）評論工具：列出待回覆評論、在院長核可後送出回覆。

用法：
  # 列出尚未回覆的評論（貼給 04 規則產初稿用）
  python3 internal/tools/gbp_reviews.py list --account <帳號ID> --location <地點ID>
  # 離線：讀 GBP／Takeout 匯出的 JSON 或 zip（同 API v4 格式）
  python3 internal/tools/gbp_reviews.py list --from-file review.zip
  # 含已回覆的全部評論
  python3 internal/tools/gbp_reviews.py list ... --all
  # 送出回覆：不加 --yes 只印出將送出的內容（dry-run）
  python3 internal/tools/gbp_reviews.py reply <評論ID> --text "回覆內容" --account ... --location ... --yes

授權：
  API 需 scope https://www.googleapis.com/auth/business.manage 的 OAuth access token。
  token 由院長以安全表單存成 mybusiness.googleapis.com 的 network secret，proxy 代為帶入；
  本腳本只送占位值，不讀、不印、不存任何金鑰。也可用環境變數 GBP_ACCESS_TOKEN（僅限本機臨時測試）。
  帳號 ID／地點 ID 不寫進 repo（repo 為公開），以參數或環境變數 GBP_ACCOUNT／GBP_LOCATION 傳入。

隱私（repo 為公開）：
  評論者姓名與評論原文只輸出到終端或 session 暫存區，絕不 commit。
  回覆一律由院長逐則核可後才送出（02 §3-4、04 第三節）。
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile

API = "https://mybusiness.googleapis.com/v4"
STARS = {"FIVE": 5, "FOUR": 4, "THREE": 3, "TWO": 2, "ONE": 1}
TRANSLATION_MARKERS = ("(Translated by Google)", "(Google 翻譯)", "（Google 翻譯）")


def zh_only(text):
    for mark in TRANSLATION_MARKERS:
        i = text.find(mark)
        if i != -1:
            text = text[:i]
    return text.strip()


def request(method, url, body=None):
    token = os.environ.get("GBP_ACCESS_TOKEN") or "placeholder-injected-by-proxy"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        sys.exit(f"API 錯誤 HTTP {e.code}：{detail}")


def location_path(args):
    account = args.account or os.environ.get("GBP_ACCOUNT")
    location = args.location or os.environ.get("GBP_LOCATION")
    if not account or not location:
        sys.exit("缺少 --account／--location（或環境變數 GBP_ACCOUNT／GBP_LOCATION）")
    return f"accounts/{account}/locations/{location}"


def fetch_api(args):
    base = f"{API}/{location_path(args)}/reviews"
    reviews, token = [], ""
    while True:
        url = f"{base}?pageSize=50&orderBy=updateTime%20desc"
        if token:
            url += "&pageToken=" + token
        page = request("GET", url)
        reviews += page.get("reviews", [])
        token = page.get("nextPageToken", "")
        if not token:
            return reviews


def load_files(path):
    blobs = []
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith(".json"):
                    blobs.append(z.read(name))
    else:
        with open(path, "rb") as f:
            blobs.append(f.read())
    reviews = {}
    for blob in blobs:
        for r in json.loads(blob).get("reviews", []):
            reviews[r["name"]] = r  # 分批檔可能重疊，依評論 ID 去重
    return list(reviews.values())


def cmd_list(args):
    reviews = load_files(args.from_file) if args.from_file else fetch_api(args)
    if not args.all:
        reviews = [r for r in reviews if not r.get("reviewReply")]
    reviews.sort(key=lambda r: r.get("createTime", ""))
    for n, r in enumerate(reviews, 1):
        star = STARS.get(r.get("starRating"), 0)
        text = zh_only(r.get("comment", "")) or "（無文字）"
        date = r.get("createTime", "")[:10]
        rid = r["name"].rsplit("/", 1)[-1]
        print(f"{n}. ★{star} ({date}) {text}\n   [id={rid}]")
    sys.stdout.flush()
    print(f"\n共 {len(reviews)} 則" + ("" if args.all else "待回覆"), file=sys.stderr)


def cmd_reply(args):
    url = f"{API}/{location_path(args)}/reviews/{args.review_id}/reply"
    print(f"將送出 → {args.review_id}\n{args.text}")
    if not args.yes:
        print("（dry-run：未送出；確認內容後加 --yes）")
        return
    result = request("PUT", url, {"comment": args.text})
    print("已送出，更新時間：", result.get("updateTime", "?"))


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("list", "reply"):
        s = sub.add_parser(name)
        s.add_argument("--account")
        s.add_argument("--location")
    ls = sub.choices["list"]
    ls.add_argument("--from-file", help="匯出的 JSON 或 zip，改讀離線檔")
    ls.add_argument("--all", action="store_true", help="含已回覆")
    rp = sub.choices["reply"]
    rp.add_argument("review_id")
    rp.add_argument("--text", required=True)
    rp.add_argument("--yes", action="store_true", help="確定送出（院長已核可）")
    args = p.parse_args()
    {"list": cmd_list, "reply": cmd_reply}[args.cmd](args)


if __name__ == "__main__":
    main()
