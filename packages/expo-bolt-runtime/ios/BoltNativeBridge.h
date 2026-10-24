#import <Foundation/Foundation.h>
@interface BoltNativeBridge : NSObject
+(void)load:(NSString*)path gpu:(int)gpu callback:(void(^)(NSString*))callback;
+(void)generate:(NSString*)payload max:(int)max tag:(NSString*)tag callback:(void(^)(NSString*))callback;
+(void)cancel;
@end
