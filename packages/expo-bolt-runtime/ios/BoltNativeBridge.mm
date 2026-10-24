#import "BoltNativeBridge.h"
#include "../cpp/engine.h"
static BoltEvent sink(void(^callback)(NSString*)) { return [callback](const std::string&s){callback([[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding]);}; }
@implementation BoltNativeBridge
+(void)load:(NSString*)path gpu:(int)gpu callback:(void(^)(NSString*))callback {bolt_load(path.UTF8String,gpu,4,sink(callback));}
+(void)generate:(NSString*)payload max:(int)max tag:(NSString*)tag callback:(void(^)(NSString*))callback {bolt_generate(payload.UTF8String,max,tag.UTF8String,sink(callback));}
+(void)cancel {bolt_cancel();}
@end
