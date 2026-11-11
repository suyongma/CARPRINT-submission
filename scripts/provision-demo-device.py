#!/usr/bin/env python3
"""개발 자격을 adb 표준 입력으로 전달. 토큰은 명령행/출력/APK/Git에 포함하지 않는다."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


# 차량·역할·환경 맞춰 개발 자격 찾고 연결 묶음 만듦. 토큰 들어 있으니 반환값 출력하지 말 것. _ma
def build_configuration(flavor, api_url):
    credentials = json.loads((ROOT / 'backend/.local/credentials.json').read_text())
    fixture = json.loads((ROOT / 'fixtures/stages-5-7/seed-bundle.json').read_text())

    def credential(vehicle_ref, role):
        matches = [entry for entry in credentials
                   if entry['vehicle_ref'] == vehicle_ref and entry['role'] == role]
        if len(matches) != 1:
            raise RuntimeError('Scoped credential missing or ambiguous; run setup-local.sh')
        return matches[0]

    def connection(vehicle_ref, manager_role, environment):
        collector = credential(vehicle_ref, 'vehicle_collector')
        manager = credential(vehicle_ref, manager_role)
        if collector['environment'] != environment or manager['environment'] != environment:
            raise RuntimeError('Credential environment mismatch')
        return dict(
            base_url=api_url, vehicle_ref=vehicle_ref,
            source_ref=collector['source_ref'], environment=environment,
            collector_token=collector['token'], manager_token=manager['token'],
        )

    if flavor == 'pleos':
        vehicles = [vehicle for vehicle in fixture['vehicles']
                    if vehicle['environment'] == 'pleos_emulator']
        if len(vehicles) != 1:
            raise RuntimeError('Expected one Pleos emulator binding')
        return connection(vehicles[0]['vehicle_ref'], 'report_manager', 'pleos_emulator')

    contexts = []
    # 별칭으로 결속한다. 자격 파일의 배열 순서로 차량을 추측하지 않는다.
    for vehicle_key in ['a', 'b']:
        vehicle_ref = fixture['alias_to_uuid'][f'demo-vehicle-{vehicle_key}']
        for user_key in ['a', 'b']:
            can_manage = user_key == 'a'
            role = 'report_manager' if can_manage else 'demo_user_b'
            entry = connection(vehicle_ref, role, 'simulation')
            entry.update(
                context_id=f'{vehicle_key}:{user_key}',
                vehicle_key=vehicle_key, vehicle_label=f'합성 차량 {vehicle_key.upper()}',
                user_key=user_key, user_label=f'사용자 {user_key.upper()}',
                climate_celsius=22 if can_manage else 24,
                media_volume=8 if can_manage else 12,
                can_manage_reports=can_manage,
            )
            contexts.append(entry)
    return {'contexts': contexts}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--flavor', choices=['demo', 'pleos'], required=True)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--api-url', default='http://10.0.2.2:18080')
    args = parser.parse_args()
    sdk = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk')))
    command = [str(sdk / 'platform-tools/adb'), '-s', args.serial]
    config = build_configuration(args.flavor, args.api_url)
    package = f'com.maandlee.carprint.{args.flavor}'
    # 자동차 Android는 운전자랑 기본 사용자 ID가 다를 수 있음. 현재 사용자 찾아서 그쪽 앱 저장소·Activity 써야 함. _ma
    user = subprocess.check_output(
        command + ['shell', 'am', 'get-current-user'], text=True,
    ).strip()
    if not user.isdigit():
        raise RuntimeError('Cannot determine Android foreground user')
    run_as = ['shell', 'run-as', package, '--user', user]
    subprocess.run(
        command + ['shell', 'am', 'force-stop', '--user', user, package],
        check=True, stdout=subprocess.DEVNULL,
    )
    subprocess.run(command + run_as + ['mkdir', '-p', 'files'], check=True)
    # 비밀은 표준 입력으로만 전송하며 앱은 첫 로드에서 암호화 후 원문을 삭제한다.
    subprocess.run(
        command + run_as + ['sh', '-c', "'umask 077; cat > files/bootstrap.json'"],
        input=json.dumps(config).encode(), check=True,
    )
    subprocess.run(
        command + ['shell', 'am', 'start', '--user', user, '-n',
                   f'{package}/com.maandlee.carprint.MainActivity'],
        check=True, stdout=subprocess.DEVNULL,
    )
    print(f'{args.flavor}: scoped configuration delivered; app encrypts it on first use.')


if __name__ == '__main__':
    main()
