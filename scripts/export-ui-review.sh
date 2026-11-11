#!/bin/sh
# 테스트가 그린 앱 내부 렌더 파일을 가져온다. 데스크톱·다른 앱은 캡처하지 않는다.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sdk_root="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
flavor="${1:-pleos}"
case "$flavor" in pleos|demo) ;; *) echo 'Usage: export-ui-review.sh [pleos|demo] [output-directory]' >&2; exit 1;; esac
output_dir="${2:-/tmp/carprint-ui-review}"
mkdir -p "$output_dir"
adb="$sdk_root/platform-tools/adb"
serial="${ANDROID_SERIAL:-emulator-5554}"
package="com.maandlee.carprint.$flavor"
android_user=$("$adb" -s "$serial" shell am get-current-user | tr -d '\r')
"$adb" -s "$serial" install -r "$project_root/android/app/build/outputs/apk/$flavor/debug/app-$flavor-debug.apk"
"$adb" -s "$serial" install -r "$project_root/android/app/build/outputs/apk/androidTest/$flavor/debug/app-$flavor-debug-androidTest.apk"
"$adb" -s "$serial" shell am instrument --user "$android_user" -w -e class com.maandlee.carprint.UiReviewTest "$package.test/androidx.test.runner.AndroidJUnitRunner" > "$output_dir/instrumentation.txt"
cat "$output_dir/instrumentation.txt"
grep -q '^OK (' "$output_dir/instrumentation.txt"
for screen in vehicle history space compact-layout; do
    "$adb" -s "$serial" exec-out run-as "$package" --user "$android_user" cat "files/ui-review/$screen.png" > "$output_dir/$screen.png"
done
