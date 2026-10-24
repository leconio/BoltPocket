export const zhCNPrivacyMessages = {
  "privacy.consent.accept": "同意并继续",
  "privacy.consent.adultConfirmation":
    "我已年满 18 周岁，并已阅读《隐私政策》和《用户协议》",
  "privacy.consent.decline": "不同意",
  "privacy.consent.declinedDetail":
    "BoltPocket不会进入主界面，也不会启动登录恢复、Agent、WebView 或其他联网能力。你可以关闭 App，或重新阅读后作出选择。",
  "privacy.consent.declinedTitle": "已停止联网与数据处理",
  "privacy.consent.failClosed":
    "在本机无法安全读取或保存你的选择时，BoltPocket不会绕过隐私门禁。",
  "privacy.consent.operatorPending": "待备案主体确认",
  "privacy.consent.point.local":
    "项目、对话、记忆、凭据和大部分工作数据默认保存在本机加密存储中。",
  "privacy.consent.point.network":
    "只有在你触发账号、模型或安全服务时，才会向页面列明的接收方发送完成该功能所需的数据。",
  "privacy.consent.point.permissions":
    "相机、麦克风、照片、位置、局域网等权限只会在具体功能中另行说明并申请。",
  "privacy.consent.point.tracking":
    "BoltPocket不接入广告 SDK，不申请广告标识，也不进行跨 App 跟踪。",
  "privacy.consent.privacyLink": "《隐私政策》",
  "privacy.consent.reading": "正在读取隐私选择",
  "privacy.consent.reconsider": "重新阅读并选择",
  "privacy.consent.retry": "重试",
  "privacy.consent.saveError": "无法安全保存你的选择，请解锁设备后重试。",
  "privacy.consent.separateConsent":
    "本次同意不代替敏感个人信息、模型接收方或数据跨境场景中的单独同意；相关功能会在实际发送前再次说明。",
  "privacy.consent.storageError": "无法安全读取本机隐私选择",
  "privacy.consent.summary":
    "运营者为 {operator}。请在使用中国大陆版前阅读以下说明和完整规则。",
  "privacy.consent.termsLink": "《用户协议》",
  "privacy.consent.thirdPartiesLink": "《第三方服务清单》",
  "privacy.consent.title": "隐私保护说明",
  "privacy.center.acceptedAt": "同意时间",
  "privacy.center.account": "账号与注销",
  "privacy.center.accountDetail": "查看账号资料，或永久注销在线账号",
  "privacy.center.aiRules": "生成式 AI 服务与模型公示",
  "privacy.center.contact": "个人信息与投诉请求",
  "privacy.center.contactDetail": "通过运营者邮箱申请查阅、复制、更正或删除",
  "privacy.center.controls": "数据与授权",
  "privacy.center.documents": "规则与清单",
  "privacy.center.emailSubject": "BoltPocket个人信息权利请求",
  "privacy.center.localData": "本机数据",
  "privacy.center.localDataDetail":
    "项目、对话和附件保存在本机；可在相应页面删除，清除 App 数据或卸载也会移除本机副本。",
  "privacy.center.permissions": "系统权限清单",
  "privacy.center.personalInformation": "个人信息收集清单",
  "privacy.center.policyVersion": "规则版本",
  "privacy.center.privacyPolicy": "隐私政策",
  "privacy.center.revokeAction": "撤回并停止",
  "privacy.center.revokeConfirm":
    "撤回后会立即退出主界面，停止新的账号、Agent、WebView 和其他联网处理；本机数据不会自动删除。",
  "privacy.center.revokeFailed": "无法撤回总体隐私同意，请稍后重试。",
  "privacy.center.revokeGeneral": "撤回总体隐私同意",
  "privacy.center.revokeTitle": "撤回总体隐私同意？",
  "privacy.center.status": "总体隐私选择",
  "privacy.center.statusAccepted": "已同意当前版本",
  "privacy.center.statusNotRequired": "当前发行版按具体功能分别授权",
  "privacy.center.summary":
    "集中查看处理规则、接收方、权限、保存期限，并管理可撤回的授权。",
  "privacy.center.thirdParties": "第三方服务与 SDK 清单",
  "privacy.center.title": "隐私与数据",
  "privacy.center.userAgreement": "用户协议",
} as const;

export type PrivacyMessageKey = keyof typeof zhCNPrivacyMessages;
