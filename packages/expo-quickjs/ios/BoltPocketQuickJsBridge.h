#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface BoltPocketQuickJsBridge : NSObject

+ (NSDictionary<NSString *, id> *)execute:(NSString *)code
                               executionId:(NSInteger)executionId
                                  filename:(NSString *)filename
                                 inputJson:(nullable NSString *)inputJson
                                 timeoutMs:(NSInteger)timeoutMs
                          memoryLimitBytes:(NSInteger)memoryLimitBytes
                           stackLimitBytes:(NSInteger)stackLimitBytes
                            maxOutputBytes:(NSInteger)maxOutputBytes
    NS_SWIFT_NAME(execute(_:executionId:filename:inputJson:timeoutMs:memoryLimitBytes:stackLimitBytes:maxOutputBytes:));

+ (void)cancel:(NSInteger)executionId NS_SWIFT_NAME(cancel(_:));

@end

NS_ASSUME_NONNULL_END
