#!/bin/sh
# ktfmt는 소스 형식만 변경한다. 특정 파일 경로를 인자로 전달한다.
set -eu
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
formatter="$root_dir/android/.local/tools/ktfmt-0.61.jar"
if [ ! -f "$formatter" ]; then
  mkdir -p "$(dirname "$formatter")"
  curl -fL -o "$formatter" https://repo.maven.apache.org/maven2/com/facebook/ktfmt/0.61/ktfmt-0.61-with-dependencies.jar
fi
expected=df83eccc0d72ed0eac0352509d792f6bb48f7db0cf0902a7edb56090a4804290
actual=$(shasum -a 256 "$formatter" | cut -d ' ' -f 1)
[ "$actual" = "$expected" ] || { echo 'Formatter checksum mismatch' >&2; exit 1; }
[ "$#" -gt 0 ] || { echo 'Usage: scripts/format-kotlin.sh path/to/File.kt ...' >&2; exit 1; }
exec "${JAVA_HOME:?Set JDK 17 JAVA_HOME}/bin/java" -jar "$formatter" --kotlinlang-style "$@"
