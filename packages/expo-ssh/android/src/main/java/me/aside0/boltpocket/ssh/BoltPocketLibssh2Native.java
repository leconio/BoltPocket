package dev.boltpocket.app.ssh;

/**
 * Narrow JNI boundary around the repository-built libssh2 transport.
 *
 * <p>All text crossing this boundary is explicit UTF-8 bytes. This avoids JNI modified UTF-8
 * ambiguity for remote paths and keeps the Kotlin module responsible for validating decoded
 * results before exposing them to JavaScript.
 */
final class BoltPocketLibssh2Native {
  static {
    System.loadLibrary("boltpocket_ssh");
  }

  private BoltPocketLibssh2Native() {}

  static native byte[] transportVersion();

  static native byte[] probeHostKey(byte[] host, int port, int timeoutMs);

  static native byte[] connectWithPassword(
      byte[] sessionId,
      byte[] host,
      int port,
      byte[] username,
      byte[] password,
      byte[] expectedFingerprint,
      int timeoutMs);

  static native byte[] connectWithKey(
      byte[] sessionId,
      byte[] host,
      int port,
      byte[] username,
      byte[] privateKey,
      byte[] publicKey,
      byte[] passphrase,
      byte[] expectedFingerprint,
      int timeoutMs);

  static native void disconnect(byte[] sessionId);

  static native void disconnectAll();

  static native byte[] list(byte[] sessionId, byte[] path);

  static native byte[] stat(byte[] sessionId, byte[] path);

  static native byte[] read(byte[] sessionId, byte[] path, int maxBytes);

  static native byte[] execute(
      byte[] sessionId,
      byte[] command,
      byte[] stdin,
      int maxOutputBytes,
      int timeoutMs);

  static native void write(byte[] sessionId, byte[] path, byte[] contents);

  static native void makeDirectory(byte[] sessionId, byte[] path);

  static native void rename(byte[] sessionId, byte[] from, byte[] to);

  static native void remove(byte[] sessionId, byte[] path);

  static native void setMode(byte[] sessionId, byte[] path, int mode);
}
