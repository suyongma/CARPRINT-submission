#!/usr/bin/env python3
"""설치·provision 후 실행. 계측 두 단계 사이 실제 앱 프로세스를 종료한다."""
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PHASES = ['a_prepareOfflineObservation', 'b_recoverSameObservationAndReplaySafely']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--evidence-dir', default='docs/evidence/stages-5-7')
    args = parser.parse_args()
    sdk = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk')))
    adb = [str(sdk / 'platform-tools/adb'), '-s', args.serial]
    user = subprocess.check_output(adb + ['shell', 'am', 'get-current-user'], text=True).strip()
    if not user.isdigit():
        raise RuntimeError('Cannot determine Android foreground user')
    evidence = ROOT / args.evidence_dir
    evidence.mkdir(parents=True, exist_ok=True)
    for flavor in ['demo', 'pleos']:
        package = f'com.maandlee.carprint.{flavor}'
        output = []
        for phase in PHASES:
            result = subprocess.run(
                adb + ['shell', 'am', 'instrument', '--user', user, '-w', '-e', 'class',
                       f'com.maandlee.carprint.ProcessRecoveryTest#{phase}',
                       f'{package}.test/androidx.test.runner.AndroidJUnitRunner'],
                capture_output=True, text=True, check=True,
            )
            output.append(result.stdout + result.stderr)
            if 'OK (1 test)' not in result.stdout:
                raise RuntimeError(result.stdout + result.stderr)
            subprocess.run(adb + ['shell', 'am', 'force-stop', '--user', user, package], check=True)
            output.append(f'Explicit am force-stop completed after {phase}\n')
        (evidence / f'process-recovery-{flavor}.txt').write_text('\n'.join(output))
        print(f'{flavor}: process-stop recovery and idempotent replay PASS')


if __name__ == '__main__':
    main()
