#include <jni.h>

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <libssh2.h>
#include <libssh2_sftp.h>
#include <netdb.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/opensslv.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#define BOLTPOCKET_MAX_HOST_BYTES 1024U
#define BOLTPOCKET_MAX_SESSION_ID_BYTES 512U
#define BOLTPOCKET_MAX_USERNAME_BYTES 1024U
#define BOLTPOCKET_MAX_PATH_BYTES 16384U
#define BOLTPOCKET_MAX_SECRET_BYTES 1000000U
#define BOLTPOCKET_MAX_PASSWORD_BYTES 16384U
#define BOLTPOCKET_MAX_COMMAND_BYTES 32768U
#define BOLTPOCKET_MAX_TRANSFER_BYTES 1000000U
#define BOLTPOCKET_MAX_LIST_ENTRIES 4096U
#define BOLTPOCKET_MAX_LIST_FRAME_BYTES 4194304U

typedef struct {
  unsigned char *data;
  size_t length;
  size_t capacity;
  size_t limit;
} BoltPocketBuffer;

typedef struct {
  unsigned char *bytes;
  size_t length;
} BoltPocketBytes;

typedef struct BoltPocketSession {
  char *id;
  int socket_fd;
  LIBSSH2_SESSION *session;
  struct BoltPocketSession *next;
} BoltPocketSession;

typedef struct {
  int socket_fd;
  LIBSSH2_SESSION *session;
} BoltPocketTransport;

static pthread_mutex_t g_transport_mutex = PTHREAD_MUTEX_INITIALIZER;
static BoltPocketSession *g_sessions = NULL;

static void boltpocket_throw(JNIEnv *env, const char *message) {
  if ((*env)->ExceptionCheck(env)) return;
  jclass exception_class = (*env)->FindClass(env, "java/lang/IllegalStateException");
  if (exception_class != NULL) {
    (*env)->ThrowNew(env, exception_class, message);
    (*env)->DeleteLocalRef(env, exception_class);
  }
}

static void boltpocket_cleanse(void *bytes, size_t length) {
  if (bytes != NULL && length > 0) OPENSSL_cleanse(bytes, length);
}

static int boltpocket_read_bytes(JNIEnv *env,
                             jbyteArray source,
                             size_t maximum,
                             int allow_empty,
                             BoltPocketBytes *output) {
  memset(output, 0, sizeof(*output));
  if (source == NULL) {
    boltpocket_throw(env, "SSH native input is missing.");
    return 0;
  }
  jsize length = (*env)->GetArrayLength(env, source);
  if (length < 0 || (size_t)length > maximum || (!allow_empty && length == 0)) {
    boltpocket_throw(env, "SSH native input is outside its bounds.");
    return 0;
  }
  size_t allocation = (size_t)length + 1U;
  unsigned char *bytes = (unsigned char *)calloc(allocation, 1U);
  if (bytes == NULL) {
    boltpocket_throw(env, "SSH native memory allocation failed.");
    return 0;
  }
  if (length > 0) {
    (*env)->GetByteArrayRegion(env, source, 0, length, (jbyte *)bytes);
    if ((*env)->ExceptionCheck(env)) {
      free(bytes);
      return 0;
    }
    if (memchr(bytes, 0, (size_t)length) != NULL) {
      free(bytes);
      boltpocket_throw(env, "SSH native text contains a null byte.");
      return 0;
    }
  }
  output->bytes = bytes;
  output->length = (size_t)length;
  return 1;
}

static void boltpocket_free_bytes(BoltPocketBytes *value, int sensitive) {
  if (value == NULL || value->bytes == NULL) return;
  if (sensitive) boltpocket_cleanse(value->bytes, value->length);
  free(value->bytes);
  value->bytes = NULL;
  value->length = 0;
}

static jbyteArray boltpocket_new_byte_array(JNIEnv *env,
                                        const unsigned char *bytes,
                                        size_t length) {
  if (length > (size_t)INT32_MAX) {
    boltpocket_throw(env, "SSH native result is too large.");
    return NULL;
  }
  jbyteArray result = (*env)->NewByteArray(env, (jsize)length);
  if (result == NULL) return NULL;
  if (length > 0) {
    (*env)->SetByteArrayRegion(env, result, 0, (jsize)length, (const jbyte *)bytes);
    if ((*env)->ExceptionCheck(env)) {
      (*env)->DeleteLocalRef(env, result);
      return NULL;
    }
  }
  return result;
}

static int boltpocket_buffer_reserve(BoltPocketBuffer *buffer, size_t additional) {
  if (buffer->length > buffer->limit) return 0;
  if (additional > buffer->limit - buffer->length) return 0;
  size_t required = buffer->length + additional;
  if (required <= buffer->capacity) return 1;
  size_t capacity = buffer->capacity == 0 ? 256U : buffer->capacity;
  while (capacity < required) {
    if (capacity > buffer->limit / 2U) {
      capacity = buffer->limit;
      break;
    }
    capacity *= 2U;
  }
  unsigned char *next = (unsigned char *)realloc(buffer->data, capacity);
  if (next == NULL) return 0;
  buffer->data = next;
  buffer->capacity = capacity;
  return 1;
}

static int boltpocket_buffer_append(BoltPocketBuffer *buffer,
                                const void *bytes,
                                size_t length) {
  if (!boltpocket_buffer_reserve(buffer, length)) return 0;
  if (length > 0) memcpy(buffer->data + buffer->length, bytes, length);
  buffer->length += length;
  return 1;
}

static int boltpocket_buffer_u8(BoltPocketBuffer *buffer, uint8_t value) {
  return boltpocket_buffer_append(buffer, &value, sizeof(value));
}

static int boltpocket_buffer_u32(BoltPocketBuffer *buffer, uint32_t value) {
  unsigned char bytes[4] = {
      (unsigned char)((value >> 24U) & 0xffU),
      (unsigned char)((value >> 16U) & 0xffU),
      (unsigned char)((value >> 8U) & 0xffU),
      (unsigned char)(value & 0xffU),
  };
  return boltpocket_buffer_append(buffer, bytes, sizeof(bytes));
}

static int boltpocket_buffer_u64(BoltPocketBuffer *buffer, uint64_t value) {
  unsigned char bytes[8];
  for (size_t index = 0; index < sizeof(bytes); index++) {
    bytes[index] = (unsigned char)((value >> ((7U - index) * 8U)) & 0xffU);
  }
  return boltpocket_buffer_append(buffer, bytes, sizeof(bytes));
}

static void boltpocket_buffer_set_u32(BoltPocketBuffer *buffer,
                                  size_t offset,
                                  uint32_t value) {
  if (buffer == NULL || offset + 4U > buffer->length) return;
  buffer->data[offset] = (unsigned char)((value >> 24U) & 0xffU);
  buffer->data[offset + 1U] = (unsigned char)((value >> 16U) & 0xffU);
  buffer->data[offset + 2U] = (unsigned char)((value >> 8U) & 0xffU);
  buffer->data[offset + 3U] = (unsigned char)(value & 0xffU);
}

static void boltpocket_buffer_free(BoltPocketBuffer *buffer, int sensitive) {
  if (buffer == NULL || buffer->data == NULL) return;
  if (sensitive) boltpocket_cleanse(buffer->data, buffer->length);
  free(buffer->data);
  memset(buffer, 0, sizeof(*buffer));
}

static int64_t boltpocket_monotonic_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return 0;
  return (int64_t)value.tv_sec * 1000LL + (int64_t)value.tv_nsec / 1000000LL;
}

static int boltpocket_set_socket_timeout(int socket_fd, int timeout_ms) {
  struct timeval timeout;
  timeout.tv_sec = timeout_ms / 1000;
  timeout.tv_usec = (timeout_ms % 1000) * 1000;
  return setsockopt(socket_fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) == 0 &&
         setsockopt(socket_fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)) == 0;
}

static int boltpocket_connect_socket(const char *host, int port, int timeout_ms) {
  char port_text[16];
  snprintf(port_text, sizeof(port_text), "%d", port);
  struct addrinfo hints;
  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  hints.ai_protocol = IPPROTO_TCP;
  struct addrinfo *addresses = NULL;
  if (getaddrinfo(host, port_text, &hints, &addresses) != 0) return -1;

  int connected = -1;
  for (struct addrinfo *address = addresses; address != NULL; address = address->ai_next) {
    int socket_fd = socket(address->ai_family, address->ai_socktype, address->ai_protocol);
    if (socket_fd < 0) continue;
    int flags = fcntl(socket_fd, F_GETFL, 0);
    if (flags < 0 || fcntl(socket_fd, F_SETFL, flags | O_NONBLOCK) != 0) {
      close(socket_fd);
      continue;
    }
    int result = connect(socket_fd, address->ai_addr, address->ai_addrlen);
    if (result != 0 && errno == EINPROGRESS) {
      struct pollfd descriptor = {.fd = socket_fd, .events = POLLOUT, .revents = 0};
      result = poll(&descriptor, 1, timeout_ms);
      if (result > 0) {
        int socket_error = 0;
        socklen_t socket_error_length = sizeof(socket_error);
        if (getsockopt(socket_fd,
                       SOL_SOCKET,
                       SO_ERROR,
                       &socket_error,
                       &socket_error_length) != 0 ||
            socket_error != 0) {
          result = -1;
        } else {
          result = 0;
        }
      } else {
        result = -1;
      }
    }
    if (result == 0 && fcntl(socket_fd, F_SETFL, flags) == 0 &&
        boltpocket_set_socket_timeout(socket_fd, timeout_ms)) {
      connected = socket_fd;
      break;
    }
    close(socket_fd);
  }
  freeaddrinfo(addresses);
  return connected;
}

static void boltpocket_transport_close(BoltPocketTransport *transport) {
  if (transport == NULL) return;
  if (transport->session != NULL) {
    libssh2_session_disconnect_ex(
        transport->session, SSH_DISCONNECT_BY_APPLICATION, "", "");
    libssh2_session_free(transport->session);
    transport->session = NULL;
  }
  if (transport->socket_fd >= 0) {
    close(transport->socket_fd);
    transport->socket_fd = -1;
  }
}

static int boltpocket_transport_open(const char *host,
                                 int port,
                                 int timeout_ms,
                                 BoltPocketTransport *transport) {
  transport->socket_fd = -1;
  transport->session = NULL;
  int socket_fd = boltpocket_connect_socket(host, port, timeout_ms);
  if (socket_fd < 0) return 0;
  LIBSSH2_SESSION *session = libssh2_session_init();
  if (session == NULL) {
    close(socket_fd);
    return 0;
  }
  libssh2_session_set_blocking(session, 1);
  libssh2_session_set_timeout(session, (long)timeout_ms);
  if (libssh2_session_handshake(session, socket_fd) != 0) {
    libssh2_session_free(session);
    close(socket_fd);
    return 0;
  }
  libssh2_keepalive_config(session, 1, 15);
  transport->socket_fd = socket_fd;
  transport->session = session;
  return 1;
}

static const char *boltpocket_host_algorithm(int type) {
  switch (type) {
    case LIBSSH2_HOSTKEY_TYPE_RSA:
      return "ssh-rsa";
    case LIBSSH2_HOSTKEY_TYPE_DSS:
      return "ssh-dss";
#ifdef LIBSSH2_HOSTKEY_TYPE_ECDSA_256
    case LIBSSH2_HOSTKEY_TYPE_ECDSA_256:
      return "ecdsa-sha2-nistp256";
#endif
#ifdef LIBSSH2_HOSTKEY_TYPE_ECDSA_384
    case LIBSSH2_HOSTKEY_TYPE_ECDSA_384:
      return "ecdsa-sha2-nistp384";
#endif
#ifdef LIBSSH2_HOSTKEY_TYPE_ECDSA_521
    case LIBSSH2_HOSTKEY_TYPE_ECDSA_521:
      return "ecdsa-sha2-nistp521";
#endif
#ifdef LIBSSH2_HOSTKEY_TYPE_ED25519
    case LIBSSH2_HOSTKEY_TYPE_ED25519:
      return "ssh-ed25519";
#endif
    default:
      return NULL;
  }
}

static int boltpocket_host_key(LIBSSH2_SESSION *session,
                           const char **algorithm,
                           char fingerprint[52]) {
  size_t key_length = 0;
  int key_type = 0;
  const char *key = libssh2_session_hostkey(session, &key_length, &key_type);
  const char *resolved_algorithm = boltpocket_host_algorithm(key_type);
  if (key == NULL || key_length == 0 || resolved_algorithm == NULL) return 0;
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digest_length = 0;
  if (EVP_Digest(key, key_length, digest, &digest_length, EVP_sha256(), NULL) != 1 ||
      digest_length != 32U) {
    boltpocket_cleanse(digest, sizeof(digest));
    return 0;
  }
  unsigned char encoded[48];
  int encoded_length = EVP_EncodeBlock(encoded, digest, (int)digest_length);
  boltpocket_cleanse(digest, sizeof(digest));
  if (encoded_length != 44) return 0;
  while (encoded_length > 0 && encoded[encoded_length - 1] == '=') encoded_length--;
  if (encoded_length != 43) return 0;
  memcpy(fingerprint, "SHA256:", 7U);
  memcpy(fingerprint + 7U, encoded, (size_t)encoded_length);
  fingerprint[7U + (size_t)encoded_length] = '\0';
  boltpocket_cleanse(encoded, sizeof(encoded));
  *algorithm = resolved_algorithm;
  return 1;
}

static int boltpocket_constant_time_equal(const char *left, const char *right) {
  size_t left_length = strlen(left);
  size_t right_length = strlen(right);
  size_t maximum = left_length > right_length ? left_length : right_length;
  unsigned char difference = (unsigned char)(left_length ^ right_length);
  for (size_t index = 0; index < maximum; index++) {
    unsigned char left_byte = index < left_length ? (unsigned char)left[index] : 0U;
    unsigned char right_byte = index < right_length ? (unsigned char)right[index] : 0U;
    difference |= (unsigned char)(left_byte ^ right_byte);
  }
  return difference == 0U;
}

static jbyteArray boltpocket_host_key_result(JNIEnv *env, LIBSSH2_SESSION *session) {
  const char *algorithm = NULL;
  char fingerprint[52];
  if (!boltpocket_host_key(session, &algorithm, fingerprint)) {
    boltpocket_throw(env, "SSH host key is unavailable or unsupported.");
    return NULL;
  }
  size_t algorithm_length = strlen(algorithm);
  size_t fingerprint_length = strlen(fingerprint);
  BoltPocketBuffer result = {.limit = 256U};
  if (!boltpocket_buffer_append(&result, algorithm, algorithm_length) ||
      !boltpocket_buffer_u8(&result, 0U) ||
      !boltpocket_buffer_append(&result, fingerprint, fingerprint_length)) {
    boltpocket_buffer_free(&result, 0);
    boltpocket_throw(env, "SSH host key result is too large.");
    return NULL;
  }
  jbyteArray output = boltpocket_new_byte_array(env, result.data, result.length);
  boltpocket_buffer_free(&result, 0);
  return output;
}

static void boltpocket_session_destroy(BoltPocketSession *entry) {
  if (entry == NULL) return;
  if (entry->session != NULL) {
    libssh2_session_disconnect_ex(entry->session,
                                  SSH_DISCONNECT_BY_APPLICATION,
                                  "",
                                  "");
    libssh2_session_free(entry->session);
  }
  if (entry->socket_fd >= 0) close(entry->socket_fd);
  if (entry->id != NULL) free(entry->id);
  free(entry);
}

static BoltPocketSession *boltpocket_session_find(const char *id) {
  for (BoltPocketSession *entry = g_sessions; entry != NULL; entry = entry->next) {
    if (strcmp(entry->id, id) == 0) return entry;
  }
  return NULL;
}

static BoltPocketSession *boltpocket_session_remove(const char *id) {
  BoltPocketSession **cursor = &g_sessions;
  while (*cursor != NULL) {
    if (strcmp((*cursor)->id, id) == 0) {
      BoltPocketSession *removed = *cursor;
      *cursor = removed->next;
      removed->next = NULL;
      return removed;
    }
    cursor = &(*cursor)->next;
  }
  return NULL;
}

static void boltpocket_sessions_clear(void) {
  BoltPocketSession *entry = g_sessions;
  g_sessions = NULL;
  while (entry != NULL) {
    BoltPocketSession *next = entry->next;
    boltpocket_session_destroy(entry);
    entry = next;
  }
}

static int boltpocket_store_session(const char *id, BoltPocketTransport *transport) {
  BoltPocketSession *entry = (BoltPocketSession *)calloc(1U, sizeof(*entry));
  if (entry == NULL) return 0;
  entry->id = strdup(id);
  if (entry->id == NULL) {
    free(entry);
    return 0;
  }
  entry->socket_fd = transport->socket_fd;
  entry->session = transport->session;
  transport->socket_fd = -1;
  transport->session = NULL;
  BoltPocketSession *previous = boltpocket_session_remove(id);
  boltpocket_session_destroy(previous);
  entry->next = g_sessions;
  g_sessions = entry;
  return 1;
}

static int boltpocket_valid_path(const unsigned char *path, size_t length) {
  if (length == 0 || path[0] != '/') return 0;
  for (size_t index = 0; index < length; index++) {
    if (path[index] == '\0' || path[index] == '\\') return 0;
    if (path[index] == '.' && index + 1U < length && path[index + 1U] == '.' &&
        (index == 0 || path[index - 1U] == '/') &&
        (index + 2U == length || path[index + 2U] == '/')) {
      return 0;
    }
  }
  return 1;
}

static int boltpocket_authenticate_password(LIBSSH2_SESSION *session,
                                        const char *username,
                                        const char *password);

LIBSSH2_USERAUTH_KBDINT_RESPONSE_FUNC(boltpocket_keyboard_response) {
  (void)name;
  (void)name_len;
  (void)instruction;
  (void)instruction_len;
  (void)prompts;
  const char *password = abstract == NULL ? NULL : (const char *)*abstract;
  if (password == NULL) return;
  size_t password_length = strlen(password);
  for (int index = 0; index < num_prompts; index++) {
    responses[index].text = (char *)malloc(password_length + 1U);
    if (responses[index].text == NULL) {
      responses[index].length = 0U;
      continue;
    }
    memcpy(responses[index].text, password, password_length + 1U);
    responses[index].length = (unsigned int)password_length;
  }
}

static int boltpocket_authenticate_password(LIBSSH2_SESSION *session,
                                        const char *username,
                                        const char *password) {
  int result = libssh2_userauth_password_ex(session,
                                            username,
                                            (unsigned int)strlen(username),
                                            password,
                                            (unsigned int)strlen(password),
                                            NULL);
  if (result == 0) return 1;
  void **abstract = libssh2_session_abstract(session);
  void *previous = abstract == NULL ? NULL : *abstract;
  if (abstract != NULL) *abstract = (void *)password;
  result = libssh2_userauth_keyboard_interactive_ex(
      session,
      username,
      (unsigned int)strlen(username),
      boltpocket_keyboard_response);
  if (abstract != NULL) *abstract = previous;
  return result == 0;
}

static LIBSSH2_SFTP *boltpocket_sftp_open(JNIEnv *env, BoltPocketSession *entry) {
  if (entry == NULL || entry->session == NULL) {
    boltpocket_throw(env, "SSH session is not connected.");
    return NULL;
  }
  LIBSSH2_SFTP *sftp = libssh2_sftp_init(entry->session);
  if (sftp == NULL) boltpocket_throw(env, "Could not open the SFTP channel.");
  return sftp;
}

static uint8_t boltpocket_entry_type(const LIBSSH2_SFTP_ATTRIBUTES *attributes) {
  if ((attributes->flags & LIBSSH2_SFTP_ATTR_PERMISSIONS) == 0U) return 4U;
  if (LIBSSH2_SFTP_S_ISREG(attributes->permissions)) return 1U;
  if (LIBSSH2_SFTP_S_ISDIR(attributes->permissions)) return 2U;
  if (LIBSSH2_SFTP_S_ISLNK(attributes->permissions)) return 3U;
  return 4U;
}

static int boltpocket_append_entry(BoltPocketBuffer *buffer,
                               const LIBSSH2_SFTP_ATTRIBUTES *attributes) {
  uint64_t size = (attributes->flags & LIBSSH2_SFTP_ATTR_SIZE) != 0U
                      ? (uint64_t)attributes->filesize
                      : 0U;
  uint32_t mode = (attributes->flags & LIBSSH2_SFTP_ATTR_PERMISSIONS) != 0U
                      ? (uint32_t)attributes->permissions
                      : 0U;
  return boltpocket_buffer_u8(buffer, boltpocket_entry_type(attributes)) &&
         boltpocket_buffer_u64(buffer, size) && boltpocket_buffer_u32(buffer, mode);
}

static int boltpocket_wait_session(BoltPocketSession *entry, int64_t deadline_ms) {
  int64_t remaining = deadline_ms - boltpocket_monotonic_ms();
  if (remaining <= 0) return 0;
  int directions = libssh2_session_block_directions(entry->session);
  short events = 0;
  if ((directions & LIBSSH2_SESSION_BLOCK_INBOUND) != 0) events |= POLLIN;
  if ((directions & LIBSSH2_SESSION_BLOCK_OUTBOUND) != 0) events |= POLLOUT;
  if (events == 0) events = POLLIN | POLLOUT;
  struct pollfd descriptor = {.fd = entry->socket_fd, .events = events, .revents = 0};
  int timeout = remaining > INT32_MAX ? INT32_MAX : (int)remaining;
  int result;
  do {
    result = poll(&descriptor, 1, timeout);
  } while (result < 0 && errno == EINTR);
  return result > 0;
}

static void boltpocket_channel_close(LIBSSH2_CHANNEL *channel,
                                 BoltPocketSession *entry,
                                 int64_t deadline_ms) {
  if (channel == NULL) return;
  int result;
  do {
    result = libssh2_channel_close(channel);
  } while (result == LIBSSH2_ERROR_EAGAIN &&
           boltpocket_wait_session(entry, deadline_ms));
  libssh2_channel_free(channel);
}

static int boltpocket_execute_command(BoltPocketSession *entry,
                                  const unsigned char *command,
                                  size_t command_length,
                                  const unsigned char *input,
                                  size_t input_length,
                                  size_t maximum_output,
                                  int timeout_ms,
                                  BoltPocketBuffer *stdout_buffer,
                                  BoltPocketBuffer *stderr_buffer,
                                  int *exit_code,
                                  const char **failure) {
  long previous_timeout = libssh2_session_get_timeout(entry->session);
  int previous_blocking = libssh2_session_get_blocking(entry->session);
  libssh2_session_set_timeout(entry->session, timeout_ms);
  libssh2_session_set_blocking(entry->session, 0);
  int64_t deadline_ms = boltpocket_monotonic_ms() + (int64_t)timeout_ms;
  LIBSSH2_CHANNEL *channel = NULL;
  while (channel == NULL) {
    channel = libssh2_channel_open_session(entry->session);
    if (channel != NULL) break;
    if (libssh2_session_last_errno(entry->session) != LIBSSH2_ERROR_EAGAIN ||
        !boltpocket_wait_session(entry, deadline_ms)) {
      *failure = boltpocket_monotonic_ms() >= deadline_ms ? "timeout" : "transport";
      goto done;
    }
  }

  int result;
  do {
    result = libssh2_channel_process_startup(channel,
                                             "exec",
                                             sizeof("exec") - 1U,
                                             (const char *)command,
                                             (unsigned int)command_length);
    if (result == LIBSSH2_ERROR_EAGAIN &&
        !boltpocket_wait_session(entry, deadline_ms)) {
      result = LIBSSH2_ERROR_TIMEOUT;
      break;
    }
  } while (result == LIBSSH2_ERROR_EAGAIN);
  if (result != 0) {
    *failure = result == LIBSSH2_ERROR_TIMEOUT ? "timeout" : "transport";
    goto done;
  }

  size_t input_offset = 0;
  while (input_offset < input_length) {
    ssize_t written = libssh2_channel_write(channel,
                                            (const char *)input + input_offset,
                                            input_length - input_offset);
    if (written > 0) {
      input_offset += (size_t)written;
      continue;
    }
    if (written != LIBSSH2_ERROR_EAGAIN ||
        !boltpocket_wait_session(entry, deadline_ms)) {
      *failure = boltpocket_monotonic_ms() >= deadline_ms ? "timeout" : "transport";
      goto done;
    }
  }

  do {
    result = libssh2_channel_send_eof(channel);
    if (result == LIBSSH2_ERROR_EAGAIN &&
        !boltpocket_wait_session(entry, deadline_ms)) {
      result = LIBSSH2_ERROR_TIMEOUT;
      break;
    }
  } while (result == LIBSSH2_ERROR_EAGAIN);
  if (result != 0) {
    *failure = result == LIBSSH2_ERROR_TIMEOUT ? "timeout" : "transport";
    goto done;
  }

  unsigned char chunk[8192];
  while (libssh2_channel_eof(channel) != 1) {
    int progressed = 0;
    for (int stream = 0; stream <= 1; stream++) {
      while (1) {
        ssize_t count = libssh2_channel_read_ex(
            channel, stream, (char *)chunk, sizeof(chunk));
        if (count > 0) {
          if (stdout_buffer->length + stderr_buffer->length + (size_t)count >
              maximum_output) {
            *failure = "output-limit";
            goto done;
          }
          BoltPocketBuffer *target = stream == 0 ? stdout_buffer : stderr_buffer;
          if (!boltpocket_buffer_append(target, chunk, (size_t)count)) {
            *failure = "output-limit";
            goto done;
          }
          progressed = 1;
          continue;
        }
        if (count != 0 && count != LIBSSH2_ERROR_EAGAIN) {
          *failure = "transport";
          goto done;
        }
        break;
      }
    }
    if (!progressed && !boltpocket_wait_session(entry, deadline_ms)) {
      *failure = "timeout";
      goto done;
    }
  }
  *exit_code = libssh2_channel_get_exit_status(channel);

done:
  boltpocket_channel_close(channel, entry, deadline_ms);
  libssh2_session_set_blocking(entry->session, previous_blocking);
  libssh2_session_set_timeout(entry->session, previous_timeout);
  return *failure == NULL;
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
  (void)vm;
  (void)reserved;
  signal(SIGPIPE, SIG_IGN);
  return libssh2_init(0) == 0 ? JNI_VERSION_1_6 : JNI_ERR;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM *vm, void *reserved) {
  (void)vm;
  (void)reserved;
  pthread_mutex_lock(&g_transport_mutex);
  boltpocket_sessions_clear();
  pthread_mutex_unlock(&g_transport_mutex);
  libssh2_exit();
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_transportVersion(JNIEnv *env,
                                                               jclass type) {
  (void)type;
  const char *libssh2_runtime = libssh2_version(LIBSSH2_VERSION_NUM);
  if (libssh2_runtime == NULL) {
    boltpocket_throw(env, "SSH native transport version is unavailable.");
    return NULL;
  }
  char value[160];
  int length = snprintf(value,
                        sizeof(value),
                        "libssh2/%s;openssl/%s",
                        libssh2_runtime,
                        OPENSSL_VERSION_STR);
  if (length <= 0 || (size_t)length >= sizeof(value)) {
    boltpocket_throw(env, "SSH native transport version is invalid.");
    return NULL;
  }
  return boltpocket_new_byte_array(env, (const unsigned char *)value, (size_t)length);
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_probeHostKey(JNIEnv *env,
                                                           jclass type,
                                                           jbyteArray host_array,
                                                           jint port,
                                                           jint timeout_ms) {
  (void)type;
  BoltPocketBytes host = {0};
  if (!boltpocket_read_bytes(env, host_array, BOLTPOCKET_MAX_HOST_BYTES, 0, &host)) return NULL;
  if (port < 1 || port > 65535 || timeout_ms < 1000 || timeout_ms > 60000) {
    boltpocket_free_bytes(&host, 0);
    boltpocket_throw(env, "Invalid SSH endpoint.");
    return NULL;
  }
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketTransport transport;
  jbyteArray result = NULL;
  if (!boltpocket_transport_open((const char *)host.bytes, port, timeout_ms, &transport)) {
    boltpocket_throw(env, "Could not establish the SSH key exchange.");
  } else {
    result = boltpocket_host_key_result(env, transport.session);
    boltpocket_transport_close(&transport);
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&host, 0);
  return result;
}

static jbyteArray boltpocket_connect(JNIEnv *env,
                                BoltPocketBytes *session_id,
                                BoltPocketBytes *host,
                                jint port,
                                BoltPocketBytes *username,
                                BoltPocketBytes *expected_fingerprint,
                                jint timeout_ms,
                                BoltPocketBytes *password,
                                BoltPocketBytes *private_key,
                                BoltPocketBytes *public_key,
                                BoltPocketBytes *passphrase) {
  BoltPocketTransport transport;
  if (!boltpocket_transport_open((const char *)host->bytes, port, timeout_ms, &transport)) {
    boltpocket_throw(env, "Could not establish the SSH connection.");
    return NULL;
  }
  const char *algorithm = NULL;
  char fingerprint[52];
  if (!boltpocket_host_key(transport.session, &algorithm, fingerprint) ||
      !boltpocket_constant_time_equal(fingerprint,
                                  (const char *)expected_fingerprint->bytes)) {
    boltpocket_transport_close(&transport);
    boltpocket_throw(env, "SSH host-key verification failed.");
    return NULL;
  }
  (void)algorithm;

  int authenticated = 0;
  if (password != NULL) {
    authenticated = boltpocket_authenticate_password(transport.session,
                                                 (const char *)username->bytes,
                                                 (const char *)password->bytes);
  } else if (private_key != NULL) {
    const char *public_text = public_key != NULL && public_key->length > 0
                                  ? (const char *)public_key->bytes
                                  : NULL;
    const char *passphrase_text = passphrase != NULL && passphrase->length > 0
                                      ? (const char *)passphrase->bytes
                                      : NULL;
    authenticated =
        libssh2_userauth_publickey_frommemory(
            transport.session,
            (const char *)username->bytes,
            username->length,
            public_text,
            public_key == NULL ? 0U : public_key->length,
            (const char *)private_key->bytes,
            private_key->length,
            passphrase_text) == 0;
  }
  if (!authenticated) {
    boltpocket_transport_close(&transport);
    boltpocket_throw(env, "SSH authentication failed.");
    return NULL;
  }
  jbyteArray result = boltpocket_host_key_result(env, transport.session);
  if (result == NULL || !boltpocket_store_session((const char *)session_id->bytes, &transport)) {
    if (result != NULL) (*env)->DeleteLocalRef(env, result);
    boltpocket_transport_close(&transport);
    if (!(*env)->ExceptionCheck(env)) {
      boltpocket_throw(env, "SSH session could not be stored.");
    }
    return NULL;
  }
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_connectWithPassword(
    JNIEnv *env,
    jclass type,
    jbyteArray session_id_array,
    jbyteArray host_array,
    jint port,
    jbyteArray username_array,
    jbyteArray password_array,
    jbyteArray expected_fingerprint_array,
    jint timeout_ms) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes host = {0};
  BoltPocketBytes username = {0};
  BoltPocketBytes password = {0};
  BoltPocketBytes expected_fingerprint = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id) ||
      !boltpocket_read_bytes(env, host_array, BOLTPOCKET_MAX_HOST_BYTES, 0, &host) ||
      !boltpocket_read_bytes(env,
                         username_array,
                         BOLTPOCKET_MAX_USERNAME_BYTES,
                         0,
                         &username) ||
      !boltpocket_read_bytes(env,
                         password_array,
                         BOLTPOCKET_MAX_PASSWORD_BYTES,
                         0,
                         &password) ||
      !boltpocket_read_bytes(env,
                         expected_fingerprint_array,
                         128U,
                         0,
                         &expected_fingerprint)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&host, 0);
    boltpocket_free_bytes(&username, 0);
    boltpocket_free_bytes(&password, 1);
    boltpocket_free_bytes(&expected_fingerprint, 0);
    return NULL;
  }
  if (port < 1 || port > 65535 || timeout_ms < 1000 || timeout_ms > 60000) {
    boltpocket_throw(env, "Invalid SSH endpoint.");
  }
  pthread_mutex_lock(&g_transport_mutex);
  jbyteArray result = (*env)->ExceptionCheck(env)
                          ? NULL
                          : boltpocket_connect(env,
                                           &session_id,
                                           &host,
                                           port,
                                           &username,
                                           &expected_fingerprint,
                                           timeout_ms,
                                           &password,
                                           NULL,
                                           NULL,
                                           NULL);
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&host, 0);
  boltpocket_free_bytes(&username, 0);
  boltpocket_free_bytes(&password, 1);
  boltpocket_free_bytes(&expected_fingerprint, 0);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_connectWithKey(
    JNIEnv *env,
    jclass type,
    jbyteArray session_id_array,
    jbyteArray host_array,
    jint port,
    jbyteArray username_array,
    jbyteArray private_key_array,
    jbyteArray public_key_array,
    jbyteArray passphrase_array,
    jbyteArray expected_fingerprint_array,
    jint timeout_ms) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes host = {0};
  BoltPocketBytes username = {0};
  BoltPocketBytes private_key = {0};
  BoltPocketBytes public_key = {0};
  BoltPocketBytes passphrase = {0};
  BoltPocketBytes expected_fingerprint = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id) ||
      !boltpocket_read_bytes(env, host_array, BOLTPOCKET_MAX_HOST_BYTES, 0, &host) ||
      !boltpocket_read_bytes(env,
                         username_array,
                         BOLTPOCKET_MAX_USERNAME_BYTES,
                         0,
                         &username) ||
      !boltpocket_read_bytes(env,
                         private_key_array,
                         BOLTPOCKET_MAX_SECRET_BYTES,
                         0,
                         &private_key) ||
      !boltpocket_read_bytes(env,
                         public_key_array,
                         BOLTPOCKET_MAX_SECRET_BYTES,
                         1,
                         &public_key) ||
      !boltpocket_read_bytes(env,
                         passphrase_array,
                         BOLTPOCKET_MAX_PASSWORD_BYTES,
                         1,
                         &passphrase) ||
      !boltpocket_read_bytes(env,
                         expected_fingerprint_array,
                         128U,
                         0,
                         &expected_fingerprint)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&host, 0);
    boltpocket_free_bytes(&username, 0);
    boltpocket_free_bytes(&private_key, 1);
    boltpocket_free_bytes(&public_key, 0);
    boltpocket_free_bytes(&passphrase, 1);
    boltpocket_free_bytes(&expected_fingerprint, 0);
    return NULL;
  }
  if (port < 1 || port > 65535 || timeout_ms < 1000 || timeout_ms > 60000) {
    boltpocket_throw(env, "Invalid SSH endpoint.");
  }
  pthread_mutex_lock(&g_transport_mutex);
  jbyteArray result = (*env)->ExceptionCheck(env)
                          ? NULL
                          : boltpocket_connect(env,
                                           &session_id,
                                           &host,
                                           port,
                                           &username,
                                           &expected_fingerprint,
                                           timeout_ms,
                                           NULL,
                                           &private_key,
                                           &public_key,
                                           &passphrase);
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&host, 0);
  boltpocket_free_bytes(&username, 0);
  boltpocket_free_bytes(&private_key, 1);
  boltpocket_free_bytes(&public_key, 0);
  boltpocket_free_bytes(&passphrase, 1);
  boltpocket_free_bytes(&expected_fingerprint, 0);
  return result;
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_disconnect(JNIEnv *env,
                                                         jclass type,
                                                         jbyteArray session_id_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id)) {
    return;
  }
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketSession *entry = boltpocket_session_remove((const char *)session_id.bytes);
  boltpocket_session_destroy(entry);
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_disconnectAll(JNIEnv *env,
                                                            jclass type) {
  (void)env;
  (void)type;
  pthread_mutex_lock(&g_transport_mutex);
  boltpocket_sessions_clear();
  pthread_mutex_unlock(&g_transport_mutex);
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_list(JNIEnv *env,
                                                   jclass type,
                                                   jbyteArray session_id_array,
                                                   jbyteArray path_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id) ||
      !boltpocket_read_bytes(env, path_array, BOLTPOCKET_MAX_PATH_BYTES, 0, &path)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    return NULL;
  }
  if (!boltpocket_valid_path(path.bytes, path.length)) {
    boltpocket_throw(env, "SFTP path is invalid.");
  }
  pthread_mutex_lock(&g_transport_mutex);
  jbyteArray result = NULL;
  BoltPocketSession *entry = (*env)->ExceptionCheck(env)
                             ? NULL
                             : boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    LIBSSH2_SFTP_HANDLE *directory = libssh2_sftp_opendir(sftp, (const char *)path.bytes);
    if (directory == NULL) {
      boltpocket_throw(env, "Could not open the SFTP directory.");
    } else {
      BoltPocketBuffer frame = {.limit = BOLTPOCKET_MAX_LIST_FRAME_BYTES};
      uint32_t count = 0;
      int ok = boltpocket_buffer_u32(&frame, 0U);
      char name[4096];
      LIBSSH2_SFTP_ATTRIBUTES attributes;
      ssize_t length = 0;
      while (ok && (length = libssh2_sftp_readdir(directory,
                                                  name,
                                                  sizeof(name),
                                                  &attributes)) > 0) {
        if ((length == 1 && name[0] == '.') ||
            (length == 2 && name[0] == '.' && name[1] == '.')) {
          continue;
        }
        if (++count > BOLTPOCKET_MAX_LIST_ENTRIES) {
          ok = 0;
          break;
        }
        ok = boltpocket_buffer_u32(&frame, (uint32_t)length) &&
             boltpocket_buffer_append(&frame, name, (size_t)length) &&
             boltpocket_append_entry(&frame, &attributes);
      }
      if (length < 0) ok = 0;
      libssh2_sftp_closedir(directory);
      if (!ok) {
        boltpocket_throw(env, "SFTP directory result exceeds its bounds.");
      } else {
        boltpocket_buffer_set_u32(&frame, 0U, count);
        result = boltpocket_new_byte_array(env, frame.data, frame.length);
      }
      boltpocket_buffer_free(&frame, 0);
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_stat(JNIEnv *env,
                                                   jclass type,
                                                   jbyteArray session_id_array,
                                                   jbyteArray path_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id) ||
      !boltpocket_read_bytes(env, path_array, BOLTPOCKET_MAX_PATH_BYTES, 0, &path)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    return NULL;
  }
  if (!boltpocket_valid_path(path.bytes, path.length)) boltpocket_throw(env, "SFTP path is invalid.");
  pthread_mutex_lock(&g_transport_mutex);
  jbyteArray result = NULL;
  BoltPocketSession *entry = (*env)->ExceptionCheck(env)
                             ? NULL
                             : boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    LIBSSH2_SFTP_ATTRIBUTES attributes;
    memset(&attributes, 0, sizeof(attributes));
    int status = libssh2_sftp_stat(sftp, (const char *)path.bytes, &attributes);
    if (status == 0) {
      BoltPocketBuffer frame = {.limit = 13U};
      if (boltpocket_append_entry(&frame, &attributes)) {
        result = boltpocket_new_byte_array(env, frame.data, frame.length);
      } else {
        boltpocket_throw(env, "SFTP item result is invalid.");
      }
      boltpocket_buffer_free(&frame, 0);
    } else if (libssh2_sftp_last_error(sftp) != LIBSSH2_FX_NO_SUCH_FILE) {
      boltpocket_throw(env, "Could not read the SFTP item.");
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_read(JNIEnv *env,
                                                   jclass type,
                                                   jbyteArray session_id_array,
                                                   jbyteArray path_array,
                                                   jint maximum_bytes) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id) ||
      !boltpocket_read_bytes(env, path_array, BOLTPOCKET_MAX_PATH_BYTES, 0, &path)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    return NULL;
  }
  if (!boltpocket_valid_path(path.bytes, path.length) || maximum_bytes < 1 ||
      maximum_bytes > (jint)BOLTPOCKET_MAX_TRANSFER_BYTES) {
    boltpocket_throw(env, "SFTP read input is invalid.");
  }
  pthread_mutex_lock(&g_transport_mutex);
  jbyteArray result = NULL;
  BoltPocketSession *entry = (*env)->ExceptionCheck(env)
                             ? NULL
                             : boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    LIBSSH2_SFTP_ATTRIBUTES attributes;
    memset(&attributes, 0, sizeof(attributes));
    int status = libssh2_sftp_stat(sftp, (const char *)path.bytes, &attributes);
    if (status != 0 || boltpocket_entry_type(&attributes) != 1U ||
        ((attributes.flags & LIBSSH2_SFTP_ATTR_SIZE) != 0U &&
         attributes.filesize > (libssh2_uint64_t)maximum_bytes)) {
      boltpocket_throw(env, "SFTP path is not a bounded regular file.");
    } else {
      LIBSSH2_SFTP_HANDLE *file = libssh2_sftp_open(
          sftp, (const char *)path.bytes, LIBSSH2_FXF_READ, 0L);
      if (file == NULL) {
        boltpocket_throw(env, "Could not open the SFTP file.");
      } else {
        BoltPocketBuffer contents = {.limit = (size_t)maximum_bytes};
        unsigned char chunk[8192];
        ssize_t count;
        int ok = 1;
        while ((count = libssh2_sftp_read(file, (char *)chunk, sizeof(chunk))) > 0) {
          if (!boltpocket_buffer_append(&contents, chunk, (size_t)count)) {
            ok = 0;
            break;
          }
        }
        if (count < 0) ok = 0;
        libssh2_sftp_close(file);
        if (ok) {
          result = boltpocket_new_byte_array(env, contents.data, contents.length);
        } else {
          boltpocket_throw(env, "SFTP file exceeds its read limit or could not be read.");
        }
        boltpocket_buffer_free(&contents, 1);
      }
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_execute(JNIEnv *env,
                                                      jclass type,
                                                      jbyteArray session_id_array,
                                                      jbyteArray command_array,
                                                      jbyteArray stdin_array,
                                                      jint maximum_output,
                                                      jint timeout_ms) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes command = {0};
  BoltPocketBytes input = {0};
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         &session_id) ||
      !boltpocket_read_bytes(env,
                         command_array,
                         BOLTPOCKET_MAX_COMMAND_BYTES,
                         0,
                         &command) ||
      !boltpocket_read_bytes(env,
                         stdin_array,
                         BOLTPOCKET_MAX_TRANSFER_BYTES,
                         1,
                         &input)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&command, 0);
    boltpocket_free_bytes(&input, 1);
    return NULL;
  }
  if (maximum_output < 1 || maximum_output > (jint)BOLTPOCKET_MAX_TRANSFER_BYTES ||
      timeout_ms < 1000 || timeout_ms > 60000) {
    boltpocket_throw(env, "SSH command bounds are invalid.");
  }
  pthread_mutex_lock(&g_transport_mutex);
  jbyteArray result = NULL;
  BoltPocketSession *entry = (*env)->ExceptionCheck(env)
                             ? NULL
                             : boltpocket_session_find((const char *)session_id.bytes);
  if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  } else if (entry != NULL) {
    BoltPocketBuffer stdout_buffer = {.limit = (size_t)maximum_output};
    BoltPocketBuffer stderr_buffer = {.limit = (size_t)maximum_output};
    int exit_code = -1;
    const char *failure = NULL;
    if (boltpocket_execute_command(entry,
                               command.bytes,
                               command.length,
                               input.bytes,
                               input.length,
                               (size_t)maximum_output,
                               timeout_ms,
                               &stdout_buffer,
                               &stderr_buffer,
                               &exit_code,
                               &failure)) {
      BoltPocketBuffer frame = {.limit = (size_t)maximum_output + 12U};
      if (boltpocket_buffer_u32(&frame, (uint32_t)exit_code) &&
          boltpocket_buffer_u32(&frame, (uint32_t)stdout_buffer.length) &&
          boltpocket_buffer_u32(&frame, (uint32_t)stderr_buffer.length) &&
          boltpocket_buffer_append(&frame, stdout_buffer.data, stdout_buffer.length) &&
          boltpocket_buffer_append(&frame, stderr_buffer.data, stderr_buffer.length)) {
        result = boltpocket_new_byte_array(env, frame.data, frame.length);
      } else {
        boltpocket_throw(env, "SSH command result exceeds its bounds.");
      }
      boltpocket_buffer_free(&frame, 1);
    } else if (strcmp(failure, "timeout") == 0) {
      boltpocket_throw(env, "SSH command timed out.");
    } else if (strcmp(failure, "output-limit") == 0) {
      boltpocket_throw(env, "SSH command output exceeds the configured limit.");
    } else {
      boltpocket_throw(env, "SSH command execution failed.");
    }
    boltpocket_buffer_free(&stdout_buffer, 1);
    boltpocket_buffer_free(&stderr_buffer, 1);
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&command, 0);
  boltpocket_free_bytes(&input, 1);
  return result;
}

static int boltpocket_mutation_inputs(JNIEnv *env,
                                  jbyteArray session_id_array,
                                  jbyteArray path_array,
                                  BoltPocketBytes *session_id,
                                  BoltPocketBytes *path) {
  if (!boltpocket_read_bytes(env,
                         session_id_array,
                         BOLTPOCKET_MAX_SESSION_ID_BYTES,
                         0,
                         session_id) ||
      !boltpocket_read_bytes(env, path_array, BOLTPOCKET_MAX_PATH_BYTES, 0, path)) {
    return 0;
  }
  if (!boltpocket_valid_path(path->bytes, path->length)) {
    boltpocket_throw(env, "SFTP path is invalid.");
    return 0;
  }
  return 1;
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_write(JNIEnv *env,
                                                    jclass type,
                                                    jbyteArray session_id_array,
                                                    jbyteArray path_array,
                                                    jbyteArray contents_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  BoltPocketBytes contents = {0};
  if (!boltpocket_mutation_inputs(env,
                              session_id_array,
                              path_array,
                              &session_id,
                              &path) ||
      !boltpocket_read_bytes(env,
                         contents_array,
                         BOLTPOCKET_MAX_TRANSFER_BYTES,
                         1,
                         &contents)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    boltpocket_free_bytes(&contents, 1);
    return;
  }
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketSession *entry = boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    LIBSSH2_SFTP_HANDLE *file = libssh2_sftp_open(
        sftp,
        (const char *)path.bytes,
        LIBSSH2_FXF_WRITE | LIBSSH2_FXF_CREAT | LIBSSH2_FXF_TRUNC,
        LIBSSH2_SFTP_S_IRUSR | LIBSSH2_SFTP_S_IWUSR |
            LIBSSH2_SFTP_S_IRGRP | LIBSSH2_SFTP_S_IROTH);
    if (file == NULL) {
      boltpocket_throw(env, "Could not open the SFTP file for writing.");
    } else {
      size_t offset = 0;
      while (offset < contents.length) {
        ssize_t written = libssh2_sftp_write(
            file, (const char *)contents.bytes + offset, contents.length - offset);
        if (written <= 0) {
          boltpocket_throw(env, "Could not complete the SFTP write.");
          break;
        }
        offset += (size_t)written;
      }
      libssh2_sftp_close(file);
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
  boltpocket_free_bytes(&contents, 1);
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_makeDirectory(
    JNIEnv *env,
    jclass type,
    jbyteArray session_id_array,
    jbyteArray path_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  if (!boltpocket_mutation_inputs(env,
                              session_id_array,
                              path_array,
                              &session_id,
                              &path)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    return;
  }
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketSession *entry = boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    if (libssh2_sftp_mkdir(sftp,
                           (const char *)path.bytes,
                           LIBSSH2_SFTP_S_IRWXU | LIBSSH2_SFTP_S_IRGRP |
                               LIBSSH2_SFTP_S_IXGRP | LIBSSH2_SFTP_S_IROTH |
                               LIBSSH2_SFTP_S_IXOTH) != 0) {
      boltpocket_throw(env, "Could not create the SFTP directory.");
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_rename(JNIEnv *env,
                                                     jclass type,
                                                     jbyteArray session_id_array,
                                                     jbyteArray from_array,
                                                     jbyteArray to_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes from = {0};
  BoltPocketBytes to = {0};
  if (!boltpocket_mutation_inputs(env,
                              session_id_array,
                              from_array,
                              &session_id,
                              &from) ||
      !boltpocket_read_bytes(env, to_array, BOLTPOCKET_MAX_PATH_BYTES, 0, &to) ||
      !boltpocket_valid_path(to.bytes, to.length)) {
    if (!(*env)->ExceptionCheck(env)) boltpocket_throw(env, "SFTP path is invalid.");
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&from, 0);
    boltpocket_free_bytes(&to, 0);
    return;
  }
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketSession *entry = boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    if (libssh2_sftp_rename(sftp,
                            (const char *)from.bytes,
                            (const char *)to.bytes) != 0) {
      boltpocket_throw(env, "Could not rename the SFTP item.");
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&from, 0);
  boltpocket_free_bytes(&to, 0);
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_remove(JNIEnv *env,
                                                     jclass type,
                                                     jbyteArray session_id_array,
                                                     jbyteArray path_array) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  if (!boltpocket_mutation_inputs(env,
                              session_id_array,
                              path_array,
                              &session_id,
                              &path)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    return;
  }
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketSession *entry = boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    if (libssh2_sftp_unlink(sftp, (const char *)path.bytes) != 0) {
      boltpocket_throw(env, "Could not remove the SFTP file.");
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
}

JNIEXPORT void JNICALL
Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_setMode(JNIEnv *env,
                                                      jclass type,
                                                      jbyteArray session_id_array,
                                                      jbyteArray path_array,
                                                      jint mode) {
  (void)type;
  BoltPocketBytes session_id = {0};
  BoltPocketBytes path = {0};
  if (!boltpocket_mutation_inputs(env,
                              session_id_array,
                              path_array,
                              &session_id,
                              &path)) {
    boltpocket_free_bytes(&session_id, 0);
    boltpocket_free_bytes(&path, 0);
    return;
  }
  if (mode < 0 || mode > 07777) boltpocket_throw(env, "SFTP file mode is invalid.");
  pthread_mutex_lock(&g_transport_mutex);
  BoltPocketSession *entry = (*env)->ExceptionCheck(env)
                             ? NULL
                             : boltpocket_session_find((const char *)session_id.bytes);
  LIBSSH2_SFTP *sftp = entry == NULL ? NULL : boltpocket_sftp_open(env, entry);
  if (sftp != NULL) {
    LIBSSH2_SFTP_ATTRIBUTES attributes;
    memset(&attributes, 0, sizeof(attributes));
    attributes.flags = LIBSSH2_SFTP_ATTR_PERMISSIONS;
    // Match the iOS bridge: preserve ordinary rwx bits without ever setting
    // setuid, setgid, or the sticky bit through the transport adapter.
    attributes.permissions = (unsigned long)(mode & 0777);
    if (libssh2_sftp_setstat(sftp, (const char *)path.bytes, &attributes) != 0) {
      boltpocket_throw(env, "Could not preserve SFTP file permissions.");
    }
    libssh2_sftp_shutdown(sftp);
  } else if (entry == NULL && !(*env)->ExceptionCheck(env)) {
    boltpocket_throw(env, "SSH session is not connected.");
  }
  pthread_mutex_unlock(&g_transport_mutex);
  boltpocket_free_bytes(&session_id, 0);
  boltpocket_free_bytes(&path, 0);
}
