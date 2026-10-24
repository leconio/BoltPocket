import type { RuntimeMessageKey } from "../zh-CN/runtime.ts";

export const enRuntimeMessages = {
  "runtime.agent.action.analyzeMedia": "Analyze image",
  "runtime.agent.action.browser": "Browse web",
  "runtime.agent.action.credentialRequest": "Request credential access",
  "runtime.agent.action.edit": "Edit",
  "runtime.agent.action.editFile": "Edit project file",
  "runtime.agent.action.find": "Find",
  "runtime.agent.action.findFiles": "Find project files",
  "runtime.agent.action.generateImage": "Generate image",
  "runtime.agent.action.generateVideo": "Generate video",
  "runtime.agent.action.grep": "Search file contents",
  "runtime.agent.action.javascript": "Run calculation",
  "runtime.agent.action.list": "List",
  "runtime.agent.action.listDirectory": "List project directory",
  "runtime.agent.action.mcp": "Use MCP",
  "runtime.agent.action.projectContext": "Read project context",
  "runtime.agent.action.read": "Read",
  "runtime.agent.action.readFile": "Read project file",
  "runtime.agent.action.readSkill": "Read Skill",
  "runtime.agent.action.readProjectSkill": "Read project Skill",
  "runtime.agent.action.resourceCatalog": "Find built-in project resources",
  "runtime.agent.action.resourceCopy": "Copy resource to project",
  "runtime.agent.action.run": "Run",
  "runtime.agent.action.search": "Search",
  "runtime.agent.action.skillMarketPublish": "Publish Skill to market",
  "runtime.agent.action.skillMarketReview": "Review Skill for publication",
  "runtime.agent.action.sshConnect": "Authenticate SSH from password book",
  "runtime.agent.action.subagent": "Collaborating Agent",
  "runtime.agent.action.thirdPartyCapabilityAssess":
    "Assess third-party Skill or MCP",
  "runtime.agent.action.thirdPartyCapabilityInstall":
    "Install third-party Skill or MCP",
  "runtime.agent.action.vaultList": "Review project credential access",
  "runtime.agent.action.previewProject": "Preview project H5",
  "runtime.agent.action.write": "Write",
  "runtime.agent.action.writeFile": "Write project file",
  "runtime.agent.browser.back": "Go back",
  "runtime.agent.browser.closeTemporary": "Close temporary page",
  "runtime.agent.browser.click": "Click page control",
  "runtime.agent.browser.followLink": "Follow page link",
  "runtime.agent.browser.findText": "Find page text",
  "runtime.agent.browser.forward": "Go forward",
  "runtime.agent.browser.highlight": "Locate page control",
  "runtime.agent.browser.navigate": "Open page",
  "runtime.agent.browser.openTemporary": "Open temporary page",
  "runtime.agent.browser.readText": "Continue reading page",
  "runtime.agent.browser.reload": "Reload page",
  "runtime.agent.browser.scroll": "Scroll page",
  "runtime.agent.browser.scrollDown": "Down",
  "runtime.agent.browser.scrollUp": "Up",
  "runtime.agent.browser.snapshot": "Read current page",
  "runtime.agent.browser.status": "Check browser status",
  "runtime.agent.browser.type": "Type page text",
  "runtime.agent.browser.waitForText": "Wait for page text",
  "runtime.agent.commandUnavailable": "Command unavailable",
  "runtime.agent.change.copy": "Copy resource {path}",
  "runtime.agent.change.create": "Create file {path}",
  "runtime.agent.change.external.googleDocsTitle": "Create Google Doc",
  "runtime.agent.change.external.googleSheetsTitle": "Create Google Sheet",
  "runtime.agent.change.external.googleSlidesTitle":
    "Create Google Slides file",
  "runtime.agent.change.external.notionTitle": "Create Notion page",
  "runtime.agent.change.externalSummary": "Create document {title}",
  "runtime.agent.change.modify": "Edit content {path}",
  "runtime.agent.change.proposalSummary": "Content changes ({count} resources)",
  "runtime.agent.collaboration.failedRemaining":
    "Collaborating Agents · 1 failed, {count} still running",
  "runtime.agent.collaboration.noSummary":
    "The collaboration task returned no summary.",
  "runtime.agent.collaboration.parallel":
    "Collaborating Agents · {count} in parallel",
  "runtime.agent.collaboration.remaining":
    "Collaborating Agents · {count} still running",
  "runtime.agent.collaboration.taskFailed": "The collaboration task failed.",
  "runtime.agent.completion.moreFiles": "- {count} more files",
  "runtime.agent.completion.proposalHeader":
    "Generated changes for {count} files:",
  "runtime.agent.completion.proposalReview":
    "The changes were applied automatically. Review or undo them from the change card on this response.",
  "runtime.agent.completion.sensitive":
    "Credential access is complete. Sensitive content was not displayed or passed to other tools.",
  "runtime.agent.completion.toolOnly":
    "The operation ended without a final model explanation. The complete execution record is retained above.",
  "runtime.agent.context.compactionCompleted": "Conversation context organized",
  "runtime.agent.context.compactionFailed":
    "Could not organize conversation context",
  "runtime.agent.context.compactionStarted": "Organizing conversation context",
  "runtime.agent.context.overflowCompleted": "Context recovered",
  "runtime.agent.context.overflowFailed": "Could not recover context",
  "runtime.agent.context.overflowStarted":
    "Context is too long; organizing it before retrying",
  "runtime.agent.contextReference.connectionDetail":
    "Limited to the current project’s authorized scope",
  "runtime.agent.contextReference.connectionLabel": "Connections {count}",
  "runtime.agent.contextReference.memoryLabel": "Memories {count}",
  "runtime.agent.contextReference.memorySeparator": "; ",
  "runtime.agent.contextReference.skillLabel": "Skills {count}",
  "runtime.agent.contextReference.skillSeparator": ", ",
  "runtime.agent.detail": "{action}: {details}",
  "runtime.agent.durationSeconds": "{count} sec",
  "runtime.agent.editCount": "{count} edits",
  "runtime.agent.error.invalidResponse":
    "The model returned no valid response. Try again.",
  "runtime.agent.error.runFailed": "The model run failed. Try again later.",
  "runtime.agent.line.first": "First {count} lines",
  "runtime.agent.line.from": "From line {start}",
  "runtime.agent.line.range": "Lines {start}–{end}",
  "runtime.agent.retry.attemptStarted": "Retrying {subject}",
  "runtime.agent.retry.ended": "Retry ended for {subject}",
  "runtime.agent.retry.failed": "Retry failed for {subject}",
  "runtime.agent.retry.scheduled": "{subject} failed; preparing to retry",
  "runtime.agent.retry.scheduledProgress":
    "{subject} failed; preparing to retry ({attempt}/{maximum})",
  "runtime.agent.retry.succeeded": "Retry succeeded for {subject}",
  "runtime.agent.retry.subject.branch": "Branch summary",
  "runtime.agent.retry.subject.compaction": "Context compaction",
  "runtime.agent.retry.subject.turn": "Model request",
  "runtime.agent.status.connected": "Model ready",
  "runtime.agent.status.thinking": "Thinking",
  "runtime.agent.system.replyLanguage":
    "Reply in English unless the user asks otherwise.",
  "runtime.agent.subagent.planner": "Planning",
  "runtime.agent.subagent.reviewer": "Review",
  "runtime.agent.subagent.scout": "Exploration",
  "runtime.background.activeMultiple": "{count} conversations are running",
  "runtime.background.activeSingle": "1 conversation is running",
  "runtime.background.title": "BoltPocket is working on tasks",
  "runtime.messaging.attachment.defaultPrompt":
    "Please analyze the attached content.",
  "runtime.messaging.connection.authorizationCancelled":
    "Document authorization was cancelled. The message has not been sent to the Agent.",
  "runtime.messaging.connection.bindingFailed":
    "The connector could not bind this document link precisely.",
  "runtime.messaging.connection.googleDocs": "Connecting Google Docs",
  "runtime.messaging.connection.googleSheets": "Connecting Google Sheets",
  "runtime.messaging.connection.googleSlides": "Connecting Google Slides",
  "runtime.messaging.connection.notion": "Connecting Notion page",
  "runtime.messaging.connection.projectRequired":
    "Open a project before connecting document links.",
  "runtime.messaging.credential.saveFailed":
    "The credential could not be saved securely. To prevent a leak, this message was not sent.",
  "runtime.messaging.persistence.startFailed":
    "Encrypted local history could not be saved, so the task did not start.",
  "runtime.messaging.proposal.appliedReceiptFailed":
    "The change was applied, but its local receipt could not be saved.",
  "runtime.messaging.proposal.autoApplyFailed":
    "The change could not be applied automatically. Open the Diff, review it, and try again.",
  "runtime.messaging.proposal.executorUnavailable":
    "The change executor is not ready yet.",
  "runtime.messaging.run.alreadyRunning":
    "A task is already running in this conversation.",
  "runtime.messaging.run.capacity":
    "Up to 3 conversations can run at once. Wait for one task to finish before sending.",
  "runtime.messaging.run.failed": "The Agent run failed. Try again.",
  "runtime.messaging.run.interrupted":
    "The task was interrupted in the background. Check the result before sending again.",
  "runtime.messaging.run.interruptedAttachments":
    "The task was interrupted in the background. Restore the text and select the attachments again.",
  "runtime.messaging.run.stateChanged":
    "The task state changed. Send the message again.",
  "runtime.messaging.run.timeout":
    "The model made no progress for too long. Check your connection and try again.",
  "runtime.messaging.retry.failed": "The last task failed and can be retried.",
  "runtime.messaging.retry.failedAttachments":
    "The last task failed. Select the attachments again before sending.",
  "runtime.messaging.retry.interrupted":
    "The last task was interrupted and may have produced a result. Check the project before sending again.",
  "runtime.messaging.retry.interruptedAttachments":
    "The last task was interrupted and may have produced a result. Restore the text and select the attachments again.",
  "runtime.messaging.source.acquire": "Fetching project Source Snapshot",
  "runtime.messaging.source.cached":
    "Using project cache: {source} · {version}",
  "runtime.messaging.source.extract":
    "Validating and extracting source snapshot",
  "runtime.messaging.source.fallback":
    "Source snapshot unavailable; continuing with browser or read-only web access",
  "runtime.messaging.source.imported": "Source imported: {source} · {version}",
  "runtime.messaging.source.inspect":
    "Identifying and validating project source",
  "runtime.messaging.source.projectRequired":
    "Open a project before importing a public GitHub repository.",
  "runtime.messaging.source.store": "Saving shared project source",
  "runtime.messaging.status.generating": "Preparing the response",
  "runtime.messaging.status.connecting": "Connecting to model",
  "runtime.messaging.status.thinking": "Thinking",
  "runtime.messaging.steer.failed": "Could not add message: {error}",
  "runtime.messaging.steer.retry": "Try again",
  "runtime.messaging.steer.queued": "Added to current run",
  "runtime.messaging.tool.complete": "Complete",
  "runtime.messaging.tool.failed": "Failed",
  "runtime.messaging.tool.staged": "Added to change",
  "runtime.messaging.tool.status": "{label} · {outcome}",
  "runtime.security.capture.label.apiToken": "Access token from conversation",
  "runtime.security.capture.label.password": "Password from conversation",
  "runtime.security.capture.label.privateKey":
    "SSH private key from conversation",
  "runtime.security.capture.label.privateKeyPassphrase":
    "Private-key passphrase from conversation",
  "runtime.security.capture.label.secret": "Secret from conversation",
  "runtime.security.capture.saved":
    "[Saved securely to the password book: {label} · ••••]",
  "runtime.app.claim.failed":
    "Could not move this conversation to the selected project.",
  "runtime.app.claim.quickOnly":
    "Only quick conversations can be moved to a project.",
  "runtime.app.claim.waitForRun":
    "Wait for the current task to finish before moving it.",
  "runtime.app.connection.google.authorizationProjectRequired":
    "Select a project before authorizing Google Workspace.",
  "runtime.app.connection.google.linkRequired":
    "Enter a Google Docs, Sheets, or Slides link.",
  "runtime.app.connection.google.projectRequired":
    "Select a project before connecting a Google Workspace file.",
  "runtime.app.connection.notion.projectRequired":
    "Select a project before connecting a Notion page.",
  "runtime.app.connection.native.projectRequired":
    "Select a project before connecting files on this device.",
  "runtime.app.connector.contentMismatch":
    "The project connector returned content for a different file.",
  "runtime.app.connector.referenceMissing":
    "The project connector did not return one unique file reference.",
  "runtime.app.conversation.deleteWhileWriting":
    "A change is being written. Wait for it to finish before deleting this conversation.",
  "runtime.app.conversation.missing": "This conversation no longer exists.",
  "runtime.app.credential.deletedSshCleanup":
    "The credential was deleted. Invalid SSH connection records will be cleaned up the next time the app starts.",
  "runtime.app.credential.updatedSshInvalidated":
    "The credential was updated, but linked SSH connections must be configured again.",
  "runtime.app.file.changed": "The project file changed. Open it again.",
  "runtime.app.file.connectionChanged":
    "The file connection changed. Return to the project and try again.",
  "runtime.app.file.missing": "The current project file could not be found.",
  "runtime.app.file.projectMissing":
    "The project containing this file could not be found.",
  "runtime.app.globalMemory.createFailed":
    "Could not create the global memory. Try again.",
  "runtime.app.globalMemory.missing": "This global memory could not be found.",
  "runtime.app.globalMemory.saveFailed":
    "Could not save the global memory. Try again.",
  "runtime.app.globalSkill.createFailed":
    "Could not create the global Skill. Try again.",
  "runtime.app.globalSkill.defaultDescription": "Custom Skill",
  "runtime.app.globalSkill.missing": "This global Skill could not be found.",
  "runtime.app.globalSkill.saveFailed":
    "Could not save the global Skill. Try again.",
  "runtime.app.hydration.loading": "Loading encrypted local history",
  "runtime.app.preview.fileReferenceMissing":
    "The project connector is missing this preview file: {path}",
  "runtime.app.preview.htmlOnly":
    "Only an HTML file can be used as an H5 preview entry point.",
  "runtime.app.preview.missing":
    "The current project H5 file could not be found.",
  "runtime.app.preview.tooManyFiles":
    "The H5 preview folder contains too many files. Choose a more specific entry folder.",
  "runtime.app.project.initFailed":
    "Could not initialize the project workspace. Try again.",
  "runtime.app.projectMemory.fileMissing":
    "The project memory file no longer exists.",
  "runtime.app.projectMemory.projectMissing":
    "The project containing this memory could not be found.",
  "runtime.app.projectSkill.createFailed":
    "Could not create the project Skill. Try again.",
  "runtime.app.skillDownload.integrityFailed":
    "Skill integrity verification failed. Installation was stopped.",
  "runtime.app.skillDownload.projectMissing":
    "The project for this Skill installation could not be found.",
  "runtime.app.skillDownload.unsupported":
    "This app version cannot install the Skill safely.",
  "runtime.app.skillDownload.duplicate":
    "A Skill with the same name already exists in this project.",
  "runtime.app.skillDownload.stageFailed":
    "The Skill installation Diff could not be staged.",
  "runtime.app.skillDownload.updating": "This Skill is already updating.",
  "runtime.app.skillDownload.notDownloaded":
    "This Skill was not downloaded from the catalog.",
  "runtime.app.skillDownload.catalogMissing":
    "This Skill is no longer present in the catalog.",
  "runtime.app.skillDownload.updateUnsupported":
    "The new version is incompatible with this app, so the update was stopped.",
  "runtime.app.skillDownload.resourceMissing":
    "The Skill file no longer exists in the project.",
  "runtime.app.proposal.applying":
    "This change proposal is already being applied. Wait for the result.",
  "runtime.app.proposal.applyComplete":
    "Change complete: {count} targets passed version checks and were updated. This conversation shares one recovery point.",
  "runtime.app.proposal.historyUnavailable":
    "Encrypted local history is unavailable, so external changes cannot be applied safely.",
  "runtime.app.proposal.missing": "This change proposal could not be found.",
  "runtime.app.proposal.notPending":
    "This change proposal was already applied and cannot be applied again.",
  "runtime.app.proposal.persistenceFailed":
    "The change was applied, but its encrypted local receipt could not be saved. Do not apply it again. Keep this page open and repair local storage first.",
  "runtime.app.proposal.projectConversationMismatch":
    "The change proposal does not belong to its project conversation and cannot be applied.",
  "runtime.app.proposal.projectMissing":
    "The project for this change proposal could not be found.",
  "runtime.app.proposal.restoreComplete":
    "Restore complete: {count} targets returned to their state before the first change in this conversation.",
  "runtime.app.proposal.restorePointMissing":
    "This conversation does not have an available recovery point yet.",
  "runtime.app.proposal.stale":
    "This change proposal expired or was already applied and cannot be applied again.",
  "runtime.app.projectFile.proposalChanged":
    "The project file changed, so a change proposal cannot be created. Open the file again.",
  "runtime.app.storage.credentialVaultReadFailed":
    "The credential vault could not be read safely. Existing data will not be overwritten.",
  "runtime.app.storage.googleDocsRestoreFailed":
    "The Google Docs connection could not be restored safely. Connect it again.",
  "runtime.app.storage.googleSheetsRestoreFailed":
    "The Google Sheets connection could not be restored safely. Connect it again.",
  "runtime.app.storage.googleSlidesRestoreFailed":
    "The Google Slides connection could not be restored safely. Connect it again.",
  "runtime.app.storage.historyReadFailed":
    "Encrypted local history could not be read. Existing data will not be overwritten; try again later.",
  "runtime.app.storage.mcpConnectionsReadFailed":
    "Saved MCP connections could not be read safely. Existing data will not be overwritten.",
  "runtime.app.storage.downloadedSkillsReadFailed":
    "Downloaded Skills could not be read safely. Existing data will not be overwritten.",
  "runtime.app.mcp.notFound": "The MCP connection does not exist.",
  "runtime.app.mcp.projectMissing":
    "Choose an existing project before changing an MCP connection.",
  "runtime.app.storage.nativeConnectionsRestoreFailed":
    "Some connections could not be restored safely. Authorize them again in Connectors.",
  "runtime.app.storage.notionRestoreFailed":
    "The Notion connection could not be restored safely. Connect it again.",
  "runtime.app.storage.projectSourcesRestoreFailed":
    "Project source snapshots could not be restored safely. Import the source again.",
  "runtime.app.storage.sshConfigRestoreFailed":
    "SSH command settings could not be restored safely. Configure them again in Settings.",
  "runtime.app.storage.sshSessionRestoreFailed":
    "The SSH command session could not be restored. Connect it again in Settings.",
  "runtime.app.storage.saveFailed":
    "Encrypted local history could not be saved. External changes remain protected by the Diff and recovery point.",
  "runtime.app.ssh.credentialNotAuthorized":
    "This SSH credential is not authorized for the current project.",
  "runtime.app.workspace.conversationMissing":
    "This conversation no longer exists, so a document cannot be connected.",
  "runtime.app.workspace.defaultName": "Document workspace",
  "runtime.app.workspace.scopeFailed":
    "Could not create a secure document scope for this conversation.",
} as const satisfies Record<RuntimeMessageKey, string>;
