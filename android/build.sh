#!/usr/bin/env bash
# يبني تطبيق السائق (APK) بلا Android Studio ولا Gradle:
#   aapt2 وdalvik-exchange (dx) وzipalign وapksigner من حزم Ubuntu، وandroid.jar (API 34) من GitHub.
#   sudo apt-get install aapt dalvik-exchange zipalign apksigner
# التوقيع بملف المستخدم نفسه في كل نسخة (وإلا لا يُحدَّث التطبيق المثبت):
#   KEYSTORE=/path/althumama-driver.jks KEYSTORE_PASS='...' android/build.sh
# الناتج client/public/driver.apk، فيُنشر مع الموقع: https://althumamacar.sifr-qr.com/driver.apk
set -euo pipefail
cd "$(dirname "$0")"

VERSION_CODE=3
VERSION_NAME=1.2
MIN_SDK=24
TARGET_SDK=34
JAR_URL=https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
JAR_SHA256=6cea1df3efb77103ac3e2beb9bf4718964b0e0869ab16d39d29d5cbae1c147ad
OUT=../client/public/driver.apk

for tool in aapt2 dalvik-exchange zipalign apksigner javac zip; do
  command -v "$tool" > /dev/null || { echo "الأداة $tool غير مثبتة: sudo apt-get install aapt dalvik-exchange zipalign apksigner zip" >&2; exit 1; }
done
: "${KEYSTORE:?مسار ملف التوقيع althumama-driver.jks في KEYSTORE}"
: "${KEYSTORE_PASS:?كلمة مرور ملف التوقيع في KEYSTORE_PASS}"
export KEYSTORE_PASS

mkdir -p .cache
[ -f .cache/android.jar ] || curl -fsSL -o .cache/android.jar "$JAR_URL"
echo "$JAR_SHA256  .cache/android.jar" | sha256sum -c --quiet -

rm -rf build
mkdir -p build/gen build/classes
aapt2 compile --dir res -o build/res.zip
aapt2 link -o build/base.apk -I .cache/android.jar --manifest AndroidManifest.xml --java build/gen \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" build/res.zip
javac -source 8 -target 8 -bootclasspath .cache/android.jar -Xlint:-options -encoding UTF-8 \
  -d build/classes $(find src build/gen -name '*.java')
dalvik-exchange --dex --min-sdk-version="$MIN_SDK" --output=build/classes.dex build/classes
(cd build && zip -q -j base.apk classes.dex)
zipalign -f -p 4 build/base.apk build/aligned.apk
apksigner sign --v4-signing-enabled false --ks "$KEYSTORE" --ks-pass env:KEYSTORE_PASS --ks-key-alias driver --out "$OUT" build/aligned.apk
apksigner verify "$OUT"
echo "✔ $(cd .. && realpath --relative-to=. client/public/driver.apk) ($(du -k "$OUT" | cut -f1) KB) · النسخة $VERSION_NAME ($VERSION_CODE)"
