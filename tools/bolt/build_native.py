"""Build the pinned llama.cpp bridge in the platform's frozen workspace."""
import hashlib,json,os,pathlib,shutil,subprocess,sys
P=pathlib.Path
platform=sys.argv[1];module=P('packages/expo-bolt-runtime');build=P('build/bolt-native-'+platform)
if platform=='android':
 sdk=P(os.environ['ANDROID_HOME']);ndk=sorted((sdk/'ndk').iterdir(),key=lambda p:tuple(map(int,p.name.split('.'))))[-1]
 cmakedir=sorted((sdk/'cmake').iterdir(),key=lambda p:tuple(map(int,p.name.split('.'))))[-1]/'bin';cmake=str(cmakedir/'cmake')
 os.environ['PATH']=str(cmakedir)+os.pathsep+os.environ['PATH']
 args=[cmake,'-S',str(module/'cpp'),'-B',str(build),'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_TOOLCHAIN_FILE='+str(ndk/'build/cmake/android.toolchain.cmake'),'-DANDROID_ABI=arm64-v8a','-DANDROID_PLATFORM=android-28','-DANDROID_STL=c++_static','-DGGML_CPU_ARM_ARCH=armv8.7-a+dotprod+i8mm','-DGGML_METAL=OFF']
 vulkan=os.environ.get('BOLT_VULKAN')=='1'
 opencl=os.environ.get('BOLT_OPENCL')=='1'
 args+=['-DGGML_VULKAN='+('ON' if vulkan else 'OFF'),'-DGGML_OPENCL='+('ON' if opencl else 'OFF')]
 if opencl:
  args+=['-DOpenCL_INCLUDE_DIR='+os.environ['OPENCL_INCLUDE_DIR'],'-DOpenCL_LIBRARY='+os.environ['OPENCL_LIBRARY'],'-DGGML_OPENCL_USE_ADRENO_KERNELS=ON','-DGGML_OPENCL_EMBED_KERNELS=ON']
 if vulkan:
  includes=(build/'vulkan-include').resolve()
  headers=P(os.environ['VULKAN_HEADERS_ROOT'])
  shutil.copytree(headers/'vulkan',includes/'vulkan',dirs_exist_ok=True)
  shutil.copytree(headers/'vk_video',includes/'vk_video',dirs_exist_ok=True)
  shutil.copytree(P(os.environ['VULKAN_HPP_ROOT']),includes/'vulkan',dirs_exist_ok=True)
  shutil.copytree(P(os.environ['SPIRV_HEADERS_ROOT']),includes/'spirv',dirs_exist_ok=True)
  args+=['-DVulkan_GLSLC_EXECUTABLE='+shutil.which('glslc'),'-DVulkan_INCLUDE_DIR='+str(includes),'-DVulkan_LIBRARY='+str(ndk/'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/28/libvulkan.so'),'-DSPIRV-Headers_DIR='+os.environ['SPIRV_HEADERS_CMAKE_ROOT']]
 subprocess.run(args,check=True);subprocess.run([cmake,'--build',str(build),'--target','boltexpo','--parallel','6'],check=True)
 library=module/'android/src/main/jniLibs/arm64-v8a/libboltexpo.so';library.parent.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(build/'libboltexpo.so',library)
 strip=ndk/'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip';subprocess.run([str(strip),'--strip-unneeded',str(library)],check=True)
elif platform=='ios':
 from ios_tools import ninja
 ninja_bin,ninja_receipt=ninja()
 build=P('build/bolt-native-ios-ninja')
 cmake=shutil.which('cmake')or'/opt/homebrew/bin/cmake'
 args=[cmake,'-S',str(module/'cpp'),'-B',str(build),'-G','Ninja','-DCMAKE_MAKE_PROGRAM='+ninja_bin,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_SYSTEM_NAME=iOS','-DCMAKE_OSX_SYSROOT=iphoneos','-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=18.0','-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY','-DGGML_METAL=ON','-DGGML_METAL_EMBED_LIBRARY=ON']
 subprocess.run(args,check=True);subprocess.run([cmake,'--build',str(build),'--target','boltcore','--parallel','2'],check=True)
 library=module/'ios/libboltcore_ios.a'
 libs=[p for p in build.rglob('*.a')if 'CMakeFiles'not in p.parts]
 subprocess.run(['xcrun','libtool','-static','-o',str(library),*[str(p)for p in libs]],check=True)
else:raise SystemExit('expected android or ios')
receipt={'platform':platform,'library':str(library),'sha256':hashlib.sha256(library.read_bytes()).hexdigest(),'llama_revision':'1a24df163920a4744a95373d178d790b72a9bb2f','vulkan':platform=='android' and vulkan,'opencl':platform=='android' and opencl,'source_snapshot_id':os.environ.get('DEVFLOW_SOURCE_SNAPSHOT_ID'),'source_sha256':os.environ.get('DEVFLOW_CONTENT_SHA256')}
if platform=='ios':
 receipt['ninja']=ninja_receipt
 embedded=sorted(build.rglob('ggml-metal-embed-*.metal'))
 receipt['metal_embedded_sources']={str(p.relative_to(build)):hashlib.sha256(p.read_bytes()).hexdigest()for p in embedded}
 if not receipt['metal_embedded_sources']:raise SystemExit('Missing embedded Metal sources')
 archive=library.read_bytes()
 for source in embedded:
  if source.read_bytes()not in archive:raise SystemExit('Stale Metal archive embedding: '+str(source))
 receipt['metal_embedded_bytes_verified']=True
(build/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
