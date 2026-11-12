#!/usr/bin/env bash
# End-to-end test of the production pipeline against the dev server.
set -euo pipefail
BASE="http://localhost:3000"

PROPOSAL='{
  "title": "Uji Coba Produksi",
  "logline": "Proposal mini untuk menguji pipeline render.",
  "ratio": "16:9",
  "durationSeconds": 20,
  "styleCode": "A1",
  "styleName": "Hitam Putih Klasik (Klasik Minimalis)",
  "voiceProfile": "hangat",
  "bgm": "lembut",
  "clips": [
    {
      "index": 1,
      "stage": "Golden Hook",
      "time": "0-10s",
      "narrationEn": "Your brain lies to you every single day, and it does it so smoothly that you never notice the trick.",
      "narrationId": "Otakmu menipumu setiap hari, dan triknya begitu halus sampai kamu tidak pernah menyadarinya.",
      "beats": ["[0-3s] stickman berdiri tenang", "[3-7s] kepala muncul angka", "[7-10s] stickman terkejut"],
      "devices": ["papan tulis", "angka melayang", "kertas catatan", "jarum jam"],
      "transition": "cut cepat"
    },
    {
      "index": 2,
      "stage": "Disrupting Assumptions",
      "time": "10-20s",
      "narrationEn": "Scientists call it confirmation bias: the mind quietly hides every fact that disagrees with what you already believe.",
      "narrationId": "Para ilmuwan menyebutnya bias konfirmasi: pikiran diam-diam menyembunyikan fakta yang bertentangan dengan keyakinanmu.",
      "beats": ["[0-3s] dua kotak fakta", "[3-7s] satu kotak ditutup", "[7-10s] stickman mengangguk"],
      "devices": ["dua kotak", "kerudung", "lensa kaca", "buku terbuka"],
      "transition": "zoom keluar"
    }
  ]
}'

echo "== 1. start job =="
START=$(curl -s -X POST "$BASE/api/production/start" -H 'Content-Type: application/json' -d "{\"proposal\": $PROPOSAL, \"narrationLang\": \"id\", \"voice\": \"tongtong\"}")
echo "$START"
JOB=$(echo "$START" | python3 -c "import sys,json;print(json.load(sys.stdin)['jobId'])")
echo "JOB=$JOB"

echo "== 2. clip assets =="
for i in 1 2; do
  curl -s -X POST "$BASE/api/production/clip" -H 'Content-Type: application/json' -d "{\"jobId\": \"$JOB\", \"index\": $i}"
  echo ""
done

echo "== 3. render =="
time curl -s -X POST "$BASE/api/production/render" -H 'Content-Type: application/json' -d "{\"jobId\": \"$JOB\"}"
echo ""

echo "== 4. verify output =="
ls -la "/home/z/my-project/production/$JOB" || true
ffprobe -v error -show_entries "format=duration,size:stream=codec_type,codec_name,width,height" -of json "/home/z/my-project/production/$JOB/final.mp4"

echo "== 5. media route =="
curl -s -o /dev/null -w "video: %{http_code} %{size_download} bytes\n" "$BASE/api/media/$JOB/final.mp4"
curl -s -o /dev/null -w "range: %{http_code} %{size_download} bytes\n" -H "Range: bytes=0-1023" "$BASE/api/media/$JOB/final.mp4"
curl -s -o /dev/null -w "poster: %{http_code} %{size_download} bytes\n" "$BASE/api/media/$JOB/poster.jpg"
curl -s -o /dev/null -w "asset: %{http_code} %{size_download} bytes\n" "$BASE/api/media/$JOB/assets/clip-1.png"
curl -s -o /dev/null -w "blocked: %{http_code}\n" "$BASE/api/media/$JOB/job.json"
curl -s -o /dev/null -w "srt: %{http_code} %{size_download} bytes\n" "$BASE/api/media/$JOB/captions.srt"

echo "DONE JOB=$JOB"
