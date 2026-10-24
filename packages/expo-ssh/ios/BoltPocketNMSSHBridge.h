#import <Foundation/Foundation.h>

@class NMSSHSession;
@class NMSFTP;

NS_ASSUME_NONNULL_BEGIN

@interface BoltPocketNMSSHBridge : NSObject

+ (NMSSHSession *)makeSessionWithHost:(NSString *)host
                                  port:(NSInteger)port
                              username:(NSString *)username
    NS_SWIFT_NAME(makeSession(host:port:username:));
+ (BOOL)connectSession:(NMSSHSession *)session
        timeoutSeconds:(NSInteger)timeoutSeconds
    NS_SWIFT_NAME(connect(session:timeoutSeconds:));
+ (BOOL)authenticateSession:(NMSSHSession *)session
                   password:(NSString *)password
    NS_SWIFT_NAME(authenticate(session:password:));
+ (BOOL)authenticateSession:(NMSSHSession *)session
                  publicKey:(nullable NSString *)publicKey
                 privateKey:(NSString *)privateKey
                 passphrase:(nullable NSString *)passphrase
    NS_SWIFT_NAME(authenticate(session:publicKey:privateKey:passphrase:));
+ (void)disconnectSession:(NMSSHSession *)session
    NS_SWIFT_NAME(disconnect(session:));
+ (nullable NMSFTP *)connectSftpForSession:(NMSSHSession *)session
    NS_SWIFT_NAME(connectSftp(session:));
+ (void)disconnectSftp:(NMSFTP *)sftp NS_SWIFT_NAME(disconnect(sftp:));

+ (nullable NSDictionary<NSString *, id> *)hostKey:(NMSSHSession *)session
    NS_SWIFT_NAME(hostKey(_:));
+ (NSDictionary<NSString *, id> *)execute:(NSString *)command
                                     input:(nullable NSData *)input
                            maxOutputBytes:(NSUInteger)maxOutputBytes
                            timeoutSeconds:(NSInteger)timeoutSeconds
                                   session:(NMSSHSession *)session
    NS_SWIFT_NAME(execute(_:input:maxOutputBytes:timeoutSeconds:session:));
+ (nullable NSArray<NSDictionary<NSString *, id> *> *)list:(NSString *)path
                                                       sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(list(_:sftp:));
+ (nullable NSDictionary<NSString *, id> *)stat:(NSString *)path
                                            sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(stat(_:sftp:));
+ (nullable NSData *)read:(NSString *)path
                 maxBytes:(NSUInteger)maxBytes
                     sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(read(_:maxBytes:sftp:));
+ (BOOL)write:(NSData *)data
          path:(NSString *)path
          sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(write(_:path:sftp:));
+ (BOOL)makeDirectory:(NSString *)path
                  sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(makeDirectory(_:sftp:));
+ (BOOL)rename:(NSString *)sourcePath
            to:(NSString *)destinationPath
          sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(rename(_:to:sftp:));
+ (BOOL)remove:(NSString *)path
           sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(remove(_:sftp:));
+ (BOOL)chmod:(NSUInteger)mode
          path:(NSString *)path
          sftp:(NMSFTP *)sftp
    NS_SWIFT_NAME(chmod(_:path:sftp:));

@end

NS_ASSUME_NONNULL_END
