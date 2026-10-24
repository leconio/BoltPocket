cmake_minimum_required(VERSION 3.22.1)

project(boltpocket-quickjs LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_compile_definitions(CONFIG_VERSION="boltpocket-vendored-1.0.1")

set(BOLTPOCKET_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp")
set(BOLTPOCKET_QUICKJS_DIR "${BOLTPOCKET_CPP_DIR}/quickjs")

set(BOLTPOCKET_QUICKJS_SOURCES
  "${BOLTPOCKET_QUICKJS_DIR}/quickjs.c"
  "${BOLTPOCKET_QUICKJS_DIR}/cutils.c"
  "${BOLTPOCKET_QUICKJS_DIR}/dtoa.c"
  "${BOLTPOCKET_QUICKJS_DIR}/libregexp.c"
  "${BOLTPOCKET_QUICKJS_DIR}/libunicode.c"
)

add_library(boltpocket-quickjs SHARED
  BoltPocketQuickJsJni.cpp
  "${BOLTPOCKET_CPP_DIR}/BoltPocketQuickJsExecutor.cpp"
  ${BOLTPOCKET_QUICKJS_SOURCES}
)

set_source_files_properties(${BOLTPOCKET_QUICKJS_SOURCES}
  PROPERTIES COMPILE_OPTIONS "-w"
)

target_include_directories(boltpocket-quickjs PRIVATE
  "${BOLTPOCKET_CPP_DIR}"
  "${BOLTPOCKET_QUICKJS_DIR}"
)

target_compile_options(boltpocket-quickjs PRIVATE
  $<$<COMPILE_LANGUAGE:CXX>:-Wall;-Wextra;-Wpedantic;-Wno-c99-extensions;-Wno-c++20-extensions;-Wno-unused-parameter>
)

# NDK r27 still defaults custom shared libraries to 4 KiB ELF LOAD segments.
# Keep this repository-owned adapter loadable on both 4 KiB and 16 KiB Android
# devices without relying on generated app-level Gradle configuration.
target_link_options(boltpocket-quickjs PRIVATE
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384"
)

find_library(log-library log)
target_link_libraries(boltpocket-quickjs ${log-library})
