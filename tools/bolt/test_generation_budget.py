"""Exercise the same context-bound output budget used by the native engine."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
compiler = shutil.which("c++") or shutil.which("g++")
if not compiler:
    raise SystemExit("A C++ compiler is required for native budget verification")
source = r'''
#include "generation_budget.h"
#include <cassert>
int main() {
    assert(bolt_output_budget(7000, 16384, 2048) == 2048);
    assert(bolt_output_budget(7000, 16384, 4096) == 4096);
    assert(bolt_output_budget(16000, 16384, 4096) == 384);
    assert(bolt_output_budget(7000, 16384, 256) == 256);
    for (auto prompt : {16384, 17000}) {
        bool rejected = false;
        try { bolt_output_budget(prompt, 16384, 2048); }
        catch (const std::runtime_error &) { rejected = true; }
        assert(rejected);
    }
    bool rejected = false;
    try { bolt_output_budget(0, 16384, 0); }
    catch (const std::invalid_argument &) { rejected = true; }
    assert(rejected);
}
'''
with tempfile.TemporaryDirectory(prefix="bolt-output-budget-") as folder:
    test = Path(folder) / "budget.cpp"
    binary = Path(folder) / "budget"
    test.write_text(source, encoding="utf-8")
    subprocess.run([compiler, "-std=c++17", "-I", str(root / "packages/expo-bolt-runtime/cpp"), str(test), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Native output budget: normal, short, context-bound and overflow cases passed")
