#!/bin/bash

set -euo pipefail

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "❌ Falta OPENAI_API_KEY"
  echo "Ejemplo:"
  echo 'export OPENAI_API_KEY="tu_api_key"'
  exit 1
fi

MODEL="gpt-4o-transcribe"

echo "🎙️ Iniciando transcripción de audios..."
echo ""

find . -maxdepth 1 -type f \( \
  -iname "*.m4a" -o \
  -iname "*.mp3" -o \
  -iname "*.wav" -o \
  -iname "*.ogg" \
\) -print0 | while IFS= read -r -d '' AUDIO; do

  BASENAME="${AUDIO%.*}"
  TXT="${BASENAME}.txt"

  echo "▶️  Transcribiendo: $(basename "$AUDIO")"

  RESPONSE=$(
    curl -sS https://api.openai.com/v1/audio/transcriptions \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -F "file=@$AUDIO" \
      -F "model=$MODEL"
  )

  TEXT=$(printf '%s' "$RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
if "text" not in data:
    print("")
    sys.stderr.write(json.dumps(data, ensure_ascii=False) + "\n")
else:
    print(data["text"])
')

  if [ -z "$TEXT" ]; then
    echo "❌ Error transcribiendo: $(basename "$AUDIO")"
    exit 1
  fi

  printf '%s\n' "$TEXT" > "$TXT"

  echo "✅ Creado: $(basename "$TXT")"
  echo ""
done

echo "======================================"
echo "✅ TRANSCRIPCIÓN TERMINADA"
echo "======================================"
