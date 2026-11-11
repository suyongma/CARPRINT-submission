#!/usr/bin/env python3
"""로컬 전용 서명 키를 최초 한 번 생성하고 release APK와 해시를 제출 폴더에 준비한다."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
sdk = Path(os.environ['ANDROID_HOME'])
jdk = Path(os.environ['JAVA_HOME'])
folder = root / 'android/.local/release'
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
config_file = folder / 'signing.json'
key_file = folder / 'submission.jks'
env = os.environ.copy()
if config_file.exists():
    config = json.loads(config_file.read_text())
    if not key_file.is_file():
        raise RuntimeError('Signing key is missing. Restore the original key; do not replace it.')
else:
    if key_file.exists():
        raise RuntimeError('Signing config is missing. Restore it; do not overwrite the key.')
    password = secrets.token_hex(32)
    config = {'password': password, 'alias': 'carprint-submission'}
    env['CARPRINT_SIGNING_STORE_PASSWORD'] = password
    subprocess.run([
        str(jdk / 'bin/keytool'), '-genkeypair', '-keystore', str(key_file),
        '-storepass:env', 'CARPRINT_SIGNING_STORE_PASSWORD',
        '-keypass:env', 'CARPRINT_SIGNING_STORE_PASSWORD',
        '-alias', config['alias'], '-keyalg', 'RSA', '-keysize', '3072',
        '-validity', '3650', '-dname', 'CN=CARPRINT,OU=Demo,O=MA&LEE',
    ], env=env, check=True)
    key_file.chmod(0o600)
    with config_file.open('x') as stream:
        config_file.chmod(0o600)
        json.dump(config, stream)
env.update({
    'CARPRINT_SIGNING_STORE_FILE': str(key_file),
    'CARPRINT_SIGNING_STORE_PASSWORD': config['password'],
    'CARPRINT_SIGNING_KEY_ALIAS': config['alias'],
    'CARPRINT_SIGNING_KEY_PASSWORD': config['password'],
})
tasks = [
    './gradlew', ':app:assembleDemoRelease', ':app:assemblePleosRelease',
    ':app:lintDemoRelease', ':app:lintPleosRelease',
]
if '--with-ui-test' in sys.argv:
    tasks += ['-PcarprintTestBuildType=release', ':app:assembleDemoReleaseAndroidTest', ':app:assemblePleosReleaseAndroidTest']
subprocess.run(tasks, cwd=root / 'android', env=env, check=True)
output = root / 'private/submission/apk'
output.mkdir(parents=True, exist_ok=True)
manifest = []
for flavor in ['demo', 'pleos']:
    apk = root / f'android/app/build/outputs/apk/{flavor}/release/app-{flavor}-release.apk'
    subprocess.run([str(sdk / 'build-tools/36.0.0/apksigner'), 'verify', '--verbose', str(apk)], env=env, check=True)
    name = 'MA&LEE_CARPRINT_release.apk' if flavor == 'demo' else 'MA&LEE_CARPRINT_pleos_release.apk'
    destination = output / name
    shutil.copy2(apk, destination)
    manifest.append({'file': name, 'flavor': flavor, 'bytes': destination.stat().st_size,
                     'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
(output / 'SHA256.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('Verified signed release APKs copied to private/submission/apk. Signing secrets remain excluded from Git.')
