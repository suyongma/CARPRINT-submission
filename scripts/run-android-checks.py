#!/usr/bin/env python3
"""Pleos 운전자 사용자에서 설치→비밀 전달→계측을 수행하고 결과를 남긴다.
Gradle connected 검사의 자동 앱 정리와 달리 시연 설치/기기 설정을 유지한다.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--flavor', choices=['demo', 'pleos', 'both'], default='both')
parser.add_argument('--class-name')
parser.add_argument('--evidence-dir', default='docs/evidence/stages-5-7')
args = parser.parse_args()
adb = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk'))) / 'platform-tools/adb'
base = [str(adb), '-s', args.serial]
# ADB daemon 재시작 직후의 일시적 offline을 기다린다. AVD 미실행은 30초에 실패한다.
subprocess.run(base + ['wait-for-device'], check=True, timeout=30)
user = subprocess.check_output(base + ['shell', 'am', 'get-current-user'], text=True).strip()
if not user.isdigit():
    raise RuntimeError('Cannot determine foreground user')
output = root / args.evidence_dir
output.mkdir(parents=True, exist_ok=True)
for index, flavor in enumerate(['demo', 'pleos'] if args.flavor == 'both' else [args.flavor]):
    if index:
        # 두 flavor는 같은 클라이언트 IP를 사용한다. 서버의 로그인 요청 제한은 완화하지 않는다.
        print('Waiting for the 1-minute login rate window before the next flavor.', flush=True)
        for _ in range(61):
            time.sleep(1)
    subprocess.run(base + ['wait-for-device'], check=True, timeout=30)
    app = root / f'android/app/build/outputs/apk/{flavor}/debug/app-{flavor}-debug.apk'
    test = root / f'android/app/build/outputs/apk/androidTest/{flavor}/debug/app-{flavor}-debug-androidTest.apk'
    for apk in [app, test]:
        subprocess.run(base + ['install', '-r', str(apk)], check=True)
    subprocess.run([sys.executable, str(root / 'scripts/provision-demo-device.py'), '--flavor', flavor, '--serial', args.serial], check=True)
    command = base + ['shell', 'am', 'instrument', '--user', user, '-w']
    if args.class_name:
        command += ['-e', 'class', args.class_name]
    result = subprocess.run(command + [f'com.maandlee.carprint.{flavor}.test/androidx.test.runner.AndroidJUnitRunner'], text=True, capture_output=True)
    text = result.stdout + result.stderr
    suffix = '-focused' if args.class_name else ''
    (output / f'android-{flavor}{suffix}.txt').write_text(text)
    print(text)
    # adb가 0으로 끝나도 테스트 실패할 수 있음. 러너 성공 표식까지 봐야 진짜 통과. _ma
    if result.returncode or 'FAILURES!!!' in text or 'OK (' not in text:
        raise SystemExit(f'{flavor} instrumentation failed; see evidence log')
