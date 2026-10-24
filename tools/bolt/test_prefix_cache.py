"""Host-only integrity checks; real model restore is separately tested on S25."""
import pathlib, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parents[2]
native = root / 'packages/expo-bolt-runtime/cpp'
with tempfile.TemporaryDirectory(prefix='bolt-prefix-cache-') as directory:
    build = pathlib.Path(directory)
    subprocess.run(['cc', '-O2', '-I'+str(native/'llama/vendor/hash'), '-c', str(native/'llama/vendor/hash/sha256/sha256.c'), '-o', str(build/'sha256.o')], check=True)
    subprocess.run(['g++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-I'+str(native), '-I'+str(native/'llama/vendor'), str(root/'tools/bolt/test_prefix_cache.cpp'), str(build/'sha256.o'), '-o', str(build/'check')], check=True)
    subprocess.run([str(build/'check'),str(build/'fixtures')],check=True)
