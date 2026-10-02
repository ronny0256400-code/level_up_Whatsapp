#!/bin/bash

set -euo pipefail

BASE_DIR="$(pwd)/productos"
SOURCE_SKU="IPADAIR1-16-BLA"

if [ ! -d "$BASE_DIR" ]; then
  echo "❌ No encontré la carpeta productos dentro de:"
  echo "$(pwd)"
  exit 1
fi

cd "$BASE_DIR"

if [ ! -d "$SOURCE_SKU" ]; then
  echo "❌ No encontré la carpeta plantilla: $SOURCE_SKU"
  exit 1
fi

echo ""
echo "======================================"
echo "📱 CORRIGIENDO MULTIMEDIA DE IPADS"
echo "Plantilla: $SOURCE_SKU"
echo "======================================"
echo ""

copy_ipad_media() {
  TARGET_SKU="$1"

  echo "📦 $SOURCE_SKU → $TARGET_SKU"

  mkdir -p "$TARGET_SKU/imagen"
  mkdir -p "$TARGET_SKU/video"

  # Limpiar multimedia anterior del destino
  find "$TARGET_SKU/imagen" -maxdepth 1 -type f \
    \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) \
    -delete 2>/dev/null || true

  find "$TARGET_SKU/video" -maxdepth 1 -type f \
    \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" \) \
    -delete 2>/dev/null || true

  # Copiar imágenes
  if [ -d "$SOURCE_SKU/imagen" ]; then
    for FILE in "$SOURCE_SKU/imagen/"*; do
      [ -f "$FILE" ] || continue

      BASENAME="$(basename "$FILE")"
      NEWNAME="${BASENAME/#$SOURCE_SKU/$TARGET_SKU}"

      cp "$FILE" "$TARGET_SKU/imagen/$NEWNAME"
      echo "   🖼️  $NEWNAME"
    done
  fi

  # Copiar videos
  if [ -d "$SOURCE_SKU/video" ]; then
    for FILE in "$SOURCE_SKU/video/"*; do
      [ -f "$FILE" ] || continue

      BASENAME="$(basename "$FILE")"
      NEWNAME="${BASENAME/#$SOURCE_SKU/$TARGET_SKU}"

      cp "$FILE" "$TARGET_SKU/video/$NEWNAME"
      echo "   🎥  $NEWNAME"
    done
  fi

  echo ""
}

for DIR in IPAD*/; do
  [ -d "$DIR" ] || continue

  SKU="${DIR%/}"

  # No tocar la carpeta plantilla
  if [ "$SKU" = "$SOURCE_SKU" ]; then
    echo "✅ PLANTILLA CONSERVADA: $SKU"
    continue
  fi

  copy_ipad_media "$SKU"
done

echo "======================================"
echo "✅ IPADS CORREGIDAS"
echo "======================================"
