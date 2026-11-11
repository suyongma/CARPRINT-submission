#!/bin/sh
# Pleos VHAL 초기화를 위해 저장된 스냅샷 대신 매번 Cold boot한다.
set -eu
sdk_root="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
avd_name="CARPRINT_Pleos_API34"
if [ ! -x "$sdk_root/emulator/emulator" ]; then
  echo "Android Emulator가 없습니다. ANDROID_HOME 또는 SDK 설치 경로를 확인하세요." >&2
  exit 1
fi
if ! "$sdk_root/emulator/emulator" -list-avds | grep -Fxq "$avd_name"; then
  echo "$avd_name 가상 기기가 없습니다. docs/evidence/pleos-emulator-setup.md를 확인하세요." >&2
  exit 1
fi
exec "$sdk_root/emulator/emulator" -avd "$avd_name" -no-snapshot -no-boot-anim
