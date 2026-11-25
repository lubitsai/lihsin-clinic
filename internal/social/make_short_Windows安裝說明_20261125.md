# make_short.sh｜Windows 安裝與使用說明

> **版本：2026-11-25**。搭配 `internal/social/Reels短影音企劃_院長版_20261105.md`（Mac 版安裝見該檔 §2-2b）。
> 工具本體：`internal/tools/make_short.sh`；流程說明：`.claude/skills/short-video/SKILL.md`。
> **實測範圍**：2026-11-25 在 Ubuntu 24.04（與 WSL 預設版本相同）用 ImageMagick 6 的 `convert` 代替 `magick` 跑完整流程（Whisper／Auto-Editor 以替身程式代替）：exit 0、輸出 1080×1920／30fps、兩行字卡與中文字幕正常。**WSL 安裝本身、真正的 Whisper／Auto-Editor 尚未在診所的 Windows 電腦上實測**，任何一步出錯，把畫面訊息整段貼給 Claude session 排除。

---

## 為什麼要先裝 WSL

`make_short.sh` 是 Mac／Linux 用的 bash 腳本，Windows 不能直接執行。微軟內建的 **WSL**（Windows Subsystem for Linux）可以在 Windows 裡跑一個 Ubuntu，腳本和工具都裝在 Ubuntu 裡；錄音檔、成片仍然放在 Windows 的資料夾，用檔案總管就看得到。

**電腦需求**：Windows 10（版本 2004 以上）或 Windows 11；硬碟至少留 10 GB；第一次安裝約 30～60 分鐘，大部分時間在下載。

---

## 一、安裝 WSL 與 Ubuntu（只做一次）

1. 在「開始」按右鍵 →「**終端機（系統管理員）**」或「**Windows PowerShell（系統管理員）**」。
2. 輸入下面這行，按 Enter：
   ```powershell
   wsl --install
   ```
3. 跑完後**重新開機**。
4. 重開機後會自動跳出 Ubuntu 視窗（沒跳出就在「開始」搜尋 **Ubuntu** 打開），照指示：
   - 設定一個**英文小寫**的使用者名稱（例如 `lihsin`）
   - 設定密碼（輸入時畫面不會顯示字，是正常的）。**這組密碼之後裝東西會用到，請記下來。**

> 出現「虛擬化未啟用」之類的錯誤：需要到電腦 BIOS 開啟虛擬化（Intel VT-x／AMD-V），這一步請電腦廠商或 IT 協助。

以下第二～五節都在 **Ubuntu 視窗** 裡輸入（不是 PowerShell）。

---

## 二、安裝工具（只做一次）

1. **影片處理、字卡、中文字型**（會要求輸入第一節設定的密碼）：
   ```bash
   sudo apt update
   sudo apt install -y ffmpeg imagemagick fonts-noto-cjk pipx
   pipx ensurepath
   ```
   跑完**關掉 Ubuntu 視窗再重新打開**。

2. **語音轉字幕（Whisper）與去停頓（Auto-Editor）**（Whisper 會下載約 1～2 GB）：
   ```bash
   pipx install openai-whisper
   pipx install auto-editor
   ```

3. **補一個 `magick` 指令**。Ubuntu 的 ImageMagick 是第 6 版，指令叫 `convert`，腳本找的是第 7 版的 `magick`，用下面三行補一個轉接（已實測可用）：
   ```bash
   mkdir -p ~/.local/bin
   printf '#!/bin/sh\nexec convert "$@"\n' > ~/.local/bin/magick
   chmod +x ~/.local/bin/magick
   ```

---

## 三、建立工作資料夾、下載腳本（只做一次）

工作資料夾放在 Windows 的 **C:\Reels**，錄音檔、背景圖、配樂、成片都在這裡，用檔案總管就能拖放。在 Ubuntu 裡，這個資料夾的路徑是 `/mnt/c/Reels`。

```bash
mkdir -p /mnt/c/Reels && cd /mnt/c/Reels
curl -O https://raw.githubusercontent.com/lubitsai/lihsin-clinic/main/internal/tools/make_short.sh
chmod +x make_short.sh
curl -O https://lhpedclinic.com.tw/videos/earth-to-clinic-9x16.mp4
```

最後一行是下載官網的宣傳片，用來做片尾。

> ⚠️ **不要用 Windows 的記事本打開、修改 `make_short.sh`**。記事本會改掉換行格式，腳本就不能跑了。要改腳本請交給 Claude session。

---

## 四、檢查

```bash
for c in ffmpeg ffprobe magick whisper auto-editor; do command -v $c >/dev/null && echo "✓ $c" || echo "✗ 缺 $c"; done
fc-list | grep -c "Noto Sans CJK TC"
ls /usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc
```

前五行都是 ✓、第六行的數字大於 0、最後一行有列出檔名，就完成了。
（最後一行如果顯示「No such file」，執行 `fc-list | grep -i "NotoSansCJK-Bold"`，把找到的路徑貼給 Claude session，換掉第六節指令裡的 `CARD_FONT`。）

---

## 五、做片尾（只做一次）

```bash
cd /mnt/c/Reels
ffmpeg -nostdin -y -sseof -5 -i earth-to-clinic-9x16.mp4 \
  -f lavfi -i anullsrc=r=48000:cl=stereo -map 0:v -map 1:a -t 5 \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k outro_5s.mp4
```

---

## 六、每次做一支片

1. 用檔案總管把錄音檔（例如 `reel01.m4a`）、背景圖、配樂放進 **C:\Reels**。
2. 打開 Ubuntu，輸入（以第 1 支燙傷為例；字卡照企劃第〇節已核可的版本）：
   ```bash
   cd /mnt/c/Reels
   FONT_NAME="Noto Sans CJK TC" CARD_FONT="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" \
   WHISPER_MODEL=small OUT_DIR=reel01_out \
     ./make_short.sh reel01.m4a bg_clinic.jpg bgm.mp3 "孩子燙到了\n先沖水 15 分鐘" "" outro_5s.mp4
   ```
   - 中文字型這兩個設定**每次都要加**，否則字幕會變方框。
   - `WHISPER_MODEL=small`：WSL 一般只用 CPU 轉字幕，預設的 medium 模型很慢；small 較快，錯字可能多一點，校稿時修正。電腦夠快可以拿掉這段。第一次轉字幕會再下載語音模型。
3. 腳本停下來顯示「請校對 reel01_out/cut.srt…」時，**先不要按 Enter**。
4. 用檔案總管打開 **C:\Reels\reel01_out\cut.srt**（按右鍵 → 開啟檔案 → 記事本），全選、複製，貼給 Claude session 校稿。
   - `cut.srt` 用記事本打開、修改都沒問題（只有 `make_short.sh` 不能用記事本改）。
5. 校稿後的版本經院長核可，貼回 `cut.srt` 存檔，回到 Ubuntu 視窗按 Enter。
6. 成片在 **C:\Reels\reel01_out\final_9x16.mp4**，傳到手機上檢查、上片。

下一支只要把 `reel01` 換成 `reel02`、字卡換成該支核可的字卡即可。

---

## 常見問題

| 狀況 | 處理 |
|---|---|
| `wsl --install` 說找不到指令 | Windows 版本太舊，先跑 Windows Update 再試 |
| `pipx install openai-whisper` 失敗 | 把錯誤訊息整段貼給 Claude session |
| 字幕或字卡是方框 | 指令前面漏了 `FONT_NAME`／`CARD_FONT`，或第四節字型檢查沒通過 |
| 顯示「缺少 magick」 | 第二節第 3 步沒做，或沒重開 Ubuntu 視窗 |
| `bad interpreter` 或 `\r` 相關錯誤 | `make_short.sh` 被 Windows 程式改過換行，重跑第三節的 `curl` 那兩行重新下載 |
| 轉字幕非常久 | 指令加 `WHISPER_MODEL=small`（第六節已預設加上） |
