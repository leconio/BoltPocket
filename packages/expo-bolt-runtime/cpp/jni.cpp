#include <jni.h>
#include "engine.h"
static std::string utf(JNIEnv *env,jstring s) { const char *p=env->GetStringUTFChars(s,nullptr);std::string r(p);env->ReleaseStringUTFChars(s,p);return r; }
static BoltEvent sink(JNIEnv *env,jobject obj) {
    auto method=env->GetMethodID(env->GetObjectClass(obj),"onNativeEvent","(Ljava/lang/String;)V");
    return [env,obj,method](const std::string &s){
        jbyteArray bytes=env->NewByteArray(s.size());env->SetByteArrayRegion(bytes,0,s.size(),(const jbyte*)s.data());
        jclass cls=env->FindClass("java/lang/String");auto ctor=env->GetMethodID(cls,"<init>","([BLjava/lang/String;)V");
        auto encoding=env->NewStringUTF("UTF-8");auto value=(jstring)env->NewObject(cls,ctor,bytes,encoding);
        env->CallVoidMethod(obj,method,value);env->DeleteLocalRef(value);env->DeleteLocalRef(encoding);env->DeleteLocalRef(cls);env->DeleteLocalRef(bytes);
    };
}
extern "C" JNIEXPORT void JNICALL Java_dev_boltpocket_app_BoltNative_load(JNIEnv *e,jobject o,jstring path,jint gpu,jint threads) { bolt_load(utf(e,path),gpu,threads,sink(e,o)); }
extern "C" JNIEXPORT void JNICALL Java_dev_boltpocket_app_BoltNative_generate(JNIEnv *e,jobject o,jstring messages,jint max,jstring tag) { bolt_generate(utf(e,messages),max,utf(e,tag),sink(e,o)); }
extern "C" JNIEXPORT void JNICALL Java_dev_boltpocket_app_BoltNative_cancel(JNIEnv *,jobject) { bolt_cancel(); }
extern "C" JNIEXPORT void JNICALL Java_dev_boltpocket_app_BoltNative_probe(JNIEnv *e,jobject o,jstring options) { bolt_gpu_probe(utf(e,options),sink(e,o)); }
