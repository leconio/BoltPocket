cmake_minimum_required(VERSION 3.22.1)

project(boltpocket_ssh LANGUAGES C)

if(NOT ANDROID)
  message(FATAL_ERROR "BoltPocket's SSH JNI transport must be built with the Android NDK.")
endif()

foreach(required_path IN ITEMS BOLTPOCKET_LIBSSH2_SOURCE BOLTPOCKET_OPENSSL_ROOT)
  if(NOT DEFINED ${required_path} OR NOT EXISTS "${${required_path}}")
    message(FATAL_ERROR "${required_path} is missing or does not exist.")
  endif()
endforeach()

if(NOT DEFINED BOLTPOCKET_BUILD_ID)
  message(FATAL_ERROR "BOLTPOCKET_BUILD_ID is required for a reproducible native artifact.")
endif()
string(LENGTH "${BOLTPOCKET_BUILD_ID}" boltpocket_build_id_length)
if(NOT boltpocket_build_id_length EQUAL 40 OR BOLTPOCKET_BUILD_ID MATCHES "[^0-9a-f]")
  message(FATAL_ERROR "BOLTPOCKET_BUILD_ID must be exactly 40 lowercase hexadecimal characters.")
endif()

# The NDK injects its own path-sensitive SHA-1 build ID before target options.
# Remove that default so the provenance-derived ID below is the only one seen
# by LLD.
string(REPLACE
  "-Wl,--build-id=sha1"
  ""
  CMAKE_SHARED_LINKER_FLAGS
  "${CMAKE_SHARED_LINKER_FLAGS}")

set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(CLEAR_MEMORY ON CACHE BOOL "" FORCE)
set(CRYPTO_BACKEND OpenSSL CACHE STRING "" FORCE)
set(ENABLE_ZLIB_COMPRESSION ON CACHE BOOL "" FORCE)
set(HIDE_SYMBOLS ON CACHE BOOL "" FORCE)
set(OPENSSL_ROOT_DIR "${BOLTPOCKET_OPENSSL_ROOT}" CACHE PATH "" FORCE)
set(OPENSSL_INCLUDE_DIR "${BOLTPOCKET_OPENSSL_ROOT}/include" CACHE PATH "" FORCE)
set(OPENSSL_CRYPTO_LIBRARY
    "${BOLTPOCKET_OPENSSL_ROOT}/lib/libcrypto.a"
    CACHE FILEPATH "" FORCE)
set(OPENSSL_USE_STATIC_LIBS TRUE CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_subdirectory("${BOLTPOCKET_LIBSSH2_SOURCE}" libssh2-build EXCLUDE_FROM_ALL)

add_library(boltpocket_ssh SHARED boltpocket_libssh2_jni.c)
target_compile_features(boltpocket_ssh PRIVATE c_std_11)
target_compile_definitions(boltpocket_ssh PRIVATE _FILE_OFFSET_BITS=64)
target_compile_options(
  boltpocket_ssh
  PRIVATE
    -Wall
    -Wextra
    -Werror
    -fstack-protector-strong)
target_include_directories(
  boltpocket_ssh
  PRIVATE
    "${BOLTPOCKET_LIBSSH2_SOURCE}/include"
    "${BOLTPOCKET_OPENSSL_ROOT}/include")
target_link_libraries(
  boltpocket_ssh
  PRIVATE
    libssh2_static
    "${BOLTPOCKET_OPENSSL_ROOT}/lib/libcrypto.a"
    z
    log
    dl)
target_link_options(
  boltpocket_ssh
  PRIVATE
    "-Wl,--exclude-libs,ALL"
    "-Wl,--build-id=0x${BOLTPOCKET_BUILD_ID}"
    "-Wl,-z,max-page-size=16384"
    "-Wl,-z,common-page-size=16384"
    "-Wl,-z,relro"
    "-Wl,-z,now")
