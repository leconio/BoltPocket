#include "prefix-cache.h"
#include <cassert>
#include <iostream>

using namespace bolt_cache;
static bool write(const fs::path & file, const std::string & value) {
    std::ofstream out(file, std::ios::binary); out << value; out.flush(); return bool(out);
}
int main(int argc, char ** argv) {
    assert(argc == 2);
    const fs::path root(argv[1]); fs::create_directories(root);
    const std::vector<int32_t> tokens{1, 20, 300};
    // Vendor SHA-256 and the model-index invalidation are independently checked.
    assert(digest("abc", 3) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    Store store(root / "cache", 128, 2);
    write(root / "model", "abc"); const auto first=store.model_identity(root / "model");
    assert(first == digest("abc",3)); write(root / "model", "abcd");
    assert(store.model_identity(root / "model") == digest("abcd",4));
    std::cout << "PASS SHA-256 and changed-model identity\n";

    assert(store.save("model-v1",tokens,5,[](const auto & file){return write(file,"state");}));
    const auto entry=store.candidate("model-v1",tokens); assert(entry && entry->bytes==5);
    assert(!store.candidate("model-v2",tokens)); assert(!store.candidate("model-v1",{1,20,301}));
    std::cout << "PASS exact model/config and token-prefix binding\n";

    write(entry->path,"corru"); assert(!store.candidate("model-v1",tokens));
    assert(store.save("model-v1",tokens,5,[](const auto & file){return write(file,"state");}));
    std::cout << "PASS corrupt state rejected before native deserialization\n";

    assert(!store.save("model-v1",tokens,5,[](const auto & file){write(file,"partial");return false;}));
    assert(store.candidate("model-v1",tokens));
    std::cout << "PASS interrupted write preserves the committed checkpoint\n";

    assert(!store.save("oversize",tokens,129,[](const auto & file){return write(file,"unused");}));
    assert(!store.save("oversize",tokens,5,[](const auto & file){return write(file,std::string(129,'x'));}));
    assert(!store.candidate("oversize",tokens));
    std::cout << "PASS cache size and disk allocation limits\n";

    write(root / "cache/unrelated.bin","keep");
    for(int index=0;index<4;++index) assert(store.save("entry-"+std::to_string(index),tokens,5,[](const auto & file){return write(file,"state");}));
    size_t count=0;
    for(const auto & file:fs::directory_iterator(root / "cache")) {
        if(file.path().extension()==".bin"&&file.path().filename().string().rfind("prefix-",0)==0)++count;
        assert(file.path().extension()!=".tmp");
    }
    assert(count==2 && fs::exists(root / "cache/unrelated.bin"));
    std::cout << "PASS bounded eviction and temporary-file cleanup\n";
}
