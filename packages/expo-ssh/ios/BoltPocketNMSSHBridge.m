#import "BoltPocketNMSSHBridge.h"

#import <NMSSH/NMSSH.h>
#import <sys/select.h>
#import <string.h>

@interface NMSFTP (BoltPocketRawSession)
- (LIBSSH2_SFTP *)sftpSession;
@end

static NSDictionary<NSString *, id> *BoltPocketEntry(
    NSString *path,
    NSString *name,
    LIBSSH2_SFTP_ATTRIBUTES attrs) {
  unsigned long permissions = attrs.permissions;
  NSString *type = @"other";
  if (LIBSSH2_SFTP_S_ISDIR(permissions)) {
    type = @"directory";
  } else if ((permissions & LIBSSH2_SFTP_S_IFMT) ==
             LIBSSH2_SFTP_S_IFLNK) {
    type = @"symlink";
  } else if (LIBSSH2_SFTP_S_ISREG(permissions)) {
    type = @"file";
  }
  unsigned long long size =
      (attrs.flags & LIBSSH2_SFTP_ATTR_SIZE) ? attrs.filesize : 0;
  return @{
    @"path": path,
    @"name": name,
    @"type": type,
    @"size": @(size),
    @"mode": @(permissions)
  };
}

static BOOL BoltPocketWaitForSession(NMSSHSession *session,
                                 CFAbsoluteTime deadline) {
  if (session.socket == NULL || session.rawSession == NULL) return NO;
  CFTimeInterval remaining = deadline - CFAbsoluteTimeGetCurrent();
  if (remaining <= 0) return NO;
  int socket = CFSocketGetNative(session.socket);
  fd_set descriptors;
  FD_ZERO(&descriptors);
  FD_SET(socket, &descriptors);
  fd_set *readDescriptors = NULL;
  fd_set *writeDescriptors = NULL;
  int directions = libssh2_session_block_directions(session.rawSession);
  if (directions & LIBSSH2_SESSION_BLOCK_INBOUND) {
    readDescriptors = &descriptors;
  }
  if (directions & LIBSSH2_SESSION_BLOCK_OUTBOUND) {
    writeDescriptors = &descriptors;
  }
  if (readDescriptors == NULL && writeDescriptors == NULL) {
    readDescriptors = &descriptors;
  }
  CFTimeInterval bounded = MIN(remaining, 0.1);
  struct timeval timeout = {
      .tv_sec = (int)bounded,
      .tv_usec = (int)((bounded - (int)bounded) * 1000000),
  };
  int result = select(socket + 1,
                      readDescriptors,
                      writeDescriptors,
                      NULL,
                      &timeout);
  return result >= 0 && CFAbsoluteTimeGetCurrent() < deadline;
}

static NSDictionary<NSString *, id> *BoltPocketExecFailure(NSString *failure) {
  return @{
    @"stdout": [NSData data],
    @"stderr": [NSData data],
    @"exitCode": @(-1),
    @"failure": failure,
  };
}

static void BoltPocketCloseExecChannel(LIBSSH2_CHANNEL *channel,
                                   NMSSHSession *session,
                                   CFAbsoluteTime deadline) {
  if (channel == NULL) return;
  int result = 0;
  do {
    result = libssh2_channel_close(channel);
    if (result == LIBSSH2_ERROR_EAGAIN &&
        !BoltPocketWaitForSession(session, deadline)) {
      break;
    }
  } while (result == LIBSSH2_ERROR_EAGAIN);
  libssh2_channel_free(channel);
}

@implementation BoltPocketNMSSHBridge

+ (NMSSHSession *)makeSessionWithHost:(NSString *)host
                                  port:(NSInteger)port
                              username:(NSString *)username {
  return [[NMSSHSession alloc] initWithHost:host
                                      port:port
                               andUsername:username];
}

+ (BOOL)connectSession:(NMSSHSession *)session
        timeoutSeconds:(NSInteger)timeoutSeconds {
  BOOL connected = [session connectWithTimeout:@(timeoutSeconds)];
  if (connected) session.timeout = @(timeoutSeconds);
  return connected;
}

+ (BOOL)authenticateSession:(NMSSHSession *)session
                   password:(NSString *)password {
  if ([session authenticateByPassword:password]) return YES;
  return [session authenticateByKeyboardInteractiveUsingBlock:^NSString *(
                      __unused NSString *request) {
    return password;
  }];
}

+ (BOOL)authenticateSession:(NMSSHSession *)session
                  publicKey:(NSString *)publicKey
                 privateKey:(NSString *)privateKey
                 passphrase:(NSString *)passphrase {
  return [session authenticateByInMemoryPublicKey:publicKey
                                       privateKey:privateKey
                                      andPassword:passphrase];
}

+ (void)disconnectSession:(NMSSHSession *)session {
  [session disconnect];
}

+ (NMSFTP *)connectSftpForSession:(NMSSHSession *)session {
  if (!session.isConnected || !session.isAuthorized) return nil;
  NMSFTP *sftp = [NMSFTP connectWithSession:session];
  return sftp.isConnected ? sftp : nil;
}

+ (void)disconnectSftp:(NMSFTP *)sftp {
  [sftp disconnect];
}

+ (NSDictionary<NSString *, id> *)hostKey:(NMSSHSession *)session {
  size_t length = 0;
  int type = 0;
  const char *bytes =
      libssh2_session_hostkey(session.rawSession, &length, &type);
  if (bytes == NULL || length == 0) {
    return nil;
  }
  NSString *algorithm = @"unknown";
  switch (type) {
    case LIBSSH2_HOSTKEY_TYPE_RSA:
      algorithm = @"ssh-rsa";
      break;
    case LIBSSH2_HOSTKEY_TYPE_DSS:
      algorithm = @"ssh-dss";
      break;
#ifdef LIBSSH2_HOSTKEY_TYPE_ECDSA_256
    case LIBSSH2_HOSTKEY_TYPE_ECDSA_256:
      algorithm = @"ecdsa-sha2-nistp256";
      break;
#endif
#ifdef LIBSSH2_HOSTKEY_TYPE_ECDSA_384
    case LIBSSH2_HOSTKEY_TYPE_ECDSA_384:
      algorithm = @"ecdsa-sha2-nistp384";
      break;
#endif
#ifdef LIBSSH2_HOSTKEY_TYPE_ECDSA_521
    case LIBSSH2_HOSTKEY_TYPE_ECDSA_521:
      algorithm = @"ecdsa-sha2-nistp521";
      break;
#endif
#ifdef LIBSSH2_HOSTKEY_TYPE_ED25519
    case LIBSSH2_HOSTKEY_TYPE_ED25519:
      algorithm = @"ssh-ed25519";
      break;
#endif
    default:
      break;
  }
  return @{
    @"algorithm": algorithm,
    @"key": [NSData dataWithBytes:bytes length:length]
  };
}

+ (NSDictionary<NSString *, id> *)execute:(NSString *)command
                                     input:(NSData *)input
                            maxOutputBytes:(NSUInteger)maxOutputBytes
                            timeoutSeconds:(NSInteger)timeoutSeconds
                                   session:(NMSSHSession *)session {
  if (!session.isConnected || !session.isAuthorized ||
      session.rawSession == NULL) {
    return BoltPocketExecFailure(@"not-connected");
  }
  CFAbsoluteTime deadline =
      CFAbsoluteTimeGetCurrent() + (CFTimeInterval)timeoutSeconds;
  int previousBlocking = libssh2_session_get_blocking(session.rawSession);
  libssh2_session_set_blocking(session.rawSession, 0);
  LIBSSH2_CHANNEL *channel = NULL;
  while (channel == NULL) {
    channel = libssh2_channel_open_session(session.rawSession);
    if (channel != NULL) break;
    if (libssh2_session_last_errno(session.rawSession) !=
            LIBSSH2_ERROR_EAGAIN ||
        !BoltPocketWaitForSession(session, deadline)) {
      libssh2_session_set_blocking(session.rawSession, previousBlocking);
      return BoltPocketExecFailure(
          CFAbsoluteTimeGetCurrent() >= deadline ? @"timeout" : @"transport");
    }
  }

  int result = 0;
  const char *commandBytes = command.UTF8String;
  do {
    result = libssh2_channel_process_startup(channel,
                                             "exec",
                                             sizeof("exec") - 1,
                                             commandBytes,
                                             (unsigned int)strlen(commandBytes));
    if (result == LIBSSH2_ERROR_EAGAIN &&
        !BoltPocketWaitForSession(session, deadline)) {
      result = LIBSSH2_ERROR_TIMEOUT;
      break;
    }
  } while (result == LIBSSH2_ERROR_EAGAIN);
  if (result != 0) {
    BoltPocketCloseExecChannel(channel, session, deadline);
    libssh2_session_set_blocking(session.rawSession, previousBlocking);
    return BoltPocketExecFailure(result == LIBSSH2_ERROR_TIMEOUT ? @"timeout"
                                                             : @"transport");
  }

  NSData *commandInput = input ?: [NSData data];
  const uint8_t *inputBytes = commandInput.bytes;
  NSUInteger inputOffset = 0;
  while (inputOffset < commandInput.length) {
    ssize_t written = libssh2_channel_write(
        channel,
        (const char *)inputBytes + inputOffset,
        commandInput.length - inputOffset);
    if (written > 0) {
      inputOffset += (NSUInteger)written;
      continue;
    }
    if (written != LIBSSH2_ERROR_EAGAIN ||
        !BoltPocketWaitForSession(session, deadline)) {
      BoltPocketCloseExecChannel(channel, session, deadline);
      libssh2_session_set_blocking(session.rawSession, previousBlocking);
      return BoltPocketExecFailure(CFAbsoluteTimeGetCurrent() >= deadline
                                   ? @"timeout"
                                   : @"transport");
    }
  }

  do {
    result = libssh2_channel_send_eof(channel);
    if (result == LIBSSH2_ERROR_EAGAIN &&
        !BoltPocketWaitForSession(session, deadline)) {
      result = LIBSSH2_ERROR_TIMEOUT;
      break;
    }
  } while (result == LIBSSH2_ERROR_EAGAIN);
  if (result != 0) {
    BoltPocketCloseExecChannel(channel, session, deadline);
    libssh2_session_set_blocking(session.rawSession, previousBlocking);
    return BoltPocketExecFailure(result == LIBSSH2_ERROR_TIMEOUT ? @"timeout"
                                                             : @"transport");
  }

  NSMutableData *stdoutData = [NSMutableData data];
  NSMutableData *stderrData = [NSMutableData data];
  char buffer[8192];
  BOOL complete = NO;
  NSString *failure = nil;
  while (!complete && failure == nil) {
    BOOL progressed = NO;
    for (int stream = 0; stream <= 1; stream++) {
      while (true) {
        ssize_t count =
            libssh2_channel_read_ex(channel, stream, buffer, sizeof(buffer));
        if (count > 0) {
          if (stdoutData.length + stderrData.length + (NSUInteger)count >
              maxOutputBytes) {
            failure = @"output-limit";
            break;
          }
          [(stream == 0 ? stdoutData : stderrData)
              appendBytes:buffer
                   length:(NSUInteger)count];
          progressed = YES;
          continue;
        }
        if (count != 0 && count != LIBSSH2_ERROR_EAGAIN) {
          failure = @"transport";
        }
        break;
      }
      if (failure != nil) break;
    }
    complete = libssh2_channel_eof(channel) == 1;
    if (!complete && failure == nil && !progressed &&
        !BoltPocketWaitForSession(session, deadline)) {
      failure = @"timeout";
    }
  }

  int exitCode = failure == nil ? libssh2_channel_get_exit_status(channel) : -1;
  BoltPocketCloseExecChannel(channel, session, deadline);
  libssh2_session_set_blocking(session.rawSession, previousBlocking);
  if (failure != nil) return BoltPocketExecFailure(failure);
  return @{
    @"stdout": stdoutData,
    @"stderr": stderrData,
    @"exitCode": @(exitCode),
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)list:(NSString *)path
                                               sftp:(NMSFTP *)sftp {
  LIBSSH2_SFTP_HANDLE *handle =
      libssh2_sftp_opendir(sftp.sftpSession, path.UTF8String);
  if (handle == NULL) {
    return nil;
  }
  NSMutableArray *entries = [NSMutableArray array];
  char buffer[4096];
  int rc = 0;
  LIBSSH2_SFTP_ATTRIBUTES attrs;
  while (true) {
    memset(&attrs, 0, sizeof(attrs));
    rc = libssh2_sftp_readdir(handle, buffer, sizeof(buffer), &attrs);
    if (rc <= 0) break;
    NSString *name = [[NSString alloc] initWithBytes:buffer
                                              length:(NSUInteger)rc
                                            encoding:NSUTF8StringEncoding];
    if (name == nil || [name isEqualToString:@"."] ||
        [name isEqualToString:@".."]) {
      continue;
    }
    NSString *fullPath =
        [[path stringByAppendingPathComponent:name] stringByStandardizingPath];
    [entries addObject:BoltPocketEntry(fullPath, name, attrs)];
  }
  libssh2_sftp_closedir(handle);
  if (rc < 0) return nil;
  return entries;
}

+ (NSDictionary<NSString *, id> *)stat:(NSString *)path
                                    sftp:(NMSFTP *)sftp {
  LIBSSH2_SFTP_ATTRIBUTES attrs;
  memset(&attrs, 0, sizeof(attrs));
  int rc = libssh2_sftp_stat_ex(sftp.sftpSession,
                                path.UTF8String,
                                (unsigned int)strlen(path.UTF8String),
                                LIBSSH2_SFTP_STAT,
                                &attrs);
  if (rc != 0) return nil;
  return BoltPocketEntry(path, path.lastPathComponent, attrs);
}

+ (NSData *)read:(NSString *)path
         maxBytes:(NSUInteger)maxBytes
             sftp:(NMSFTP *)sftp {
  LIBSSH2_SFTP_HANDLE *handle =
      libssh2_sftp_open(sftp.sftpSession, path.UTF8String, LIBSSH2_FXF_READ, 0);
  if (handle == NULL) return nil;
  NSMutableData *data = [NSMutableData data];
  char buffer[8192];
  ssize_t count = 0;
  while ((count = libssh2_sftp_read(handle, buffer, sizeof(buffer))) > 0) {
    if (data.length + (NSUInteger)count > maxBytes) {
      libssh2_sftp_close(handle);
      return nil;
    }
    [data appendBytes:buffer length:(NSUInteger)count];
  }
  libssh2_sftp_close(handle);
  if (count < 0) return nil;
  return data;
}

+ (BOOL)write:(NSData *)data
          path:(NSString *)path
          sftp:(NMSFTP *)sftp {
  LIBSSH2_SFTP_HANDLE *handle = libssh2_sftp_open(
      sftp.sftpSession,
      path.UTF8String,
      LIBSSH2_FXF_WRITE | LIBSSH2_FXF_CREAT | LIBSSH2_FXF_TRUNC,
      LIBSSH2_SFTP_S_IRUSR | LIBSSH2_SFTP_S_IWUSR |
          LIBSSH2_SFTP_S_IRGRP | LIBSSH2_SFTP_S_IROTH);
  if (handle == NULL) {
    return NO;
  }
  const uint8_t *bytes = data.bytes;
  NSUInteger offset = 0;
  while (offset < data.length) {
    ssize_t written = libssh2_sftp_write(
        handle, (const char *)bytes + offset, data.length - offset);
    if (written <= 0) {
      libssh2_sftp_close(handle);
      return NO;
    }
    offset += (NSUInteger)written;
  }
  libssh2_sftp_close(handle);
  return YES;
}

+ (BOOL)makeDirectory:(NSString *)path sftp:(NMSFTP *)sftp {
  return [sftp createDirectoryAtPath:path];
}

+ (BOOL)rename:(NSString *)sourcePath
            to:(NSString *)destinationPath
          sftp:(NMSFTP *)sftp {
  return [sftp moveItemAtPath:sourcePath toPath:destinationPath];
}

+ (BOOL)remove:(NSString *)path sftp:(NMSFTP *)sftp {
  return [sftp removeFileAtPath:path];
}

+ (BOOL)chmod:(NSUInteger)mode
          path:(NSString *)path
          sftp:(NMSFTP *)sftp {
  LIBSSH2_SFTP_ATTRIBUTES attrs;
  memset(&attrs, 0, sizeof(attrs));
  attrs.flags = LIBSSH2_SFTP_ATTR_PERMISSIONS;
  attrs.permissions = (unsigned long)(mode & 0777);
  int rc = libssh2_sftp_stat_ex(sftp.sftpSession,
                                path.UTF8String,
                                (unsigned int)strlen(path.UTF8String),
                                LIBSSH2_SFTP_SETSTAT,
                                &attrs);
  return rc == 0;
}

@end
