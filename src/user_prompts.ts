import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { doNotAskAgainAction, noRepeatPromptThreshold, noThanksAction, openDevToolsAction, wantToTryDevToolsPrompt } from "./constants";
import { Context } from "./context";
import { StagehandTemplate } from "./pub/stagehand";
import { DART_STAGEHAND_PROJECT_TRIGGER_FILE, extensionVersion, FLUTTER_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE, fsPath, getDartWorkspaceFolders, hasFlutterExtension, isDevExtension, openInBrowser, WorkspaceContext } from "./utils";

const promptPrefix = "hasPrompted.";
const installFlutterExtensionPromptKey = "install_flutter_extension";

export function showUserPrompts(context: Context, workspaceContext: WorkspaceContext): void {
	handleNewProjects(context);

	function hasPrompted(key: string): boolean {
		const stateKey = `${promptPrefix}${key}`;
		return context.get(stateKey) === true;
	}

	/// Shows a prompt and stores the return value. Prompt should return `true` to mark
	/// this extension as seen-forever and it won't be shown again. Returning anything
	/// else will allow the prompt to appear again next time.
	function showPrompt(key: string, prompt: () => Thenable<boolean>): void {
		const stateKey = `${promptPrefix}${key}`;
		prompt().then((res) => context.update(stateKey, res), error);
	}

	const versionLink = extensionVersion.split(".").slice(0, 2).join(".").replace(".", "-");
	const releaseNotesKeyForThisVersion = `release_notes_${extensionVersion}`;

	if (workspaceContext.hasAnyFlutterProjects && !hasFlutterExtension && !hasPrompted(installFlutterExtensionPromptKey))
		return showPrompt(installFlutterExtensionPromptKey, promptToInstallFlutterExtension);

	if (!isDevExtension && !hasPrompted(releaseNotesKeyForThisVersion))
		return showPrompt(releaseNotesKeyForThisVersion, () => promptToShowReleaseNotes(extensionVersion, versionLink));
}

export async function showDevToolsNotificationIfAppropriate(context: Context): Promise<boolean> {
	const lastShown = context.devToolsNotificationLastShown;
	const timesShown = context.devToolsNotificationsShown;
	const doNotShow = context.devToolsNotificationDoNotShow;

	// Don't show this notification more than 10 times or if user said not to.
	if (doNotShow || timesShown >= 10)
		return false;

	// Don't show this notification if we've shown it in the last 20 hours.
	if (lastShown && Date.now() - lastShown < noRepeatPromptThreshold)
		return false;

	context.devToolsNotificationsShown++;
	context.devToolsNotificationLastShown = Date.now();

	const choice = await vs.window.showInformationMessage(wantToTryDevToolsPrompt, openDevToolsAction, noThanksAction, doNotAskAgainAction);
	if (choice === doNotAskAgainAction) {
		context.devToolsNotificationDoNotShow = true;
		return false;
	} else if (choice === openDevToolsAction) {
		vs.commands.executeCommand("dart.openDevTools");
		return true;
	} else {
		// No thanks.
		return false;
	}
}

async function promptToInstallFlutterExtension(): Promise<boolean> {
	const res = await vs.window.showInformationMessage(
		"Working on a Flutter project? Install the Flutter extension for additional functionality.",
		"Show Me",
	);
	if (res) {
		// TODO: Can we open this in the Extensions side bar?
		openInBrowser("https://marketplace.visualstudio.com/items?itemName=Dart-Code.flutter");
	}
	return true; // Always mark this as done; we don't want to re-prompt if the user clicks Close.
}

async function promptToShowReleaseNotes(versionDisplay: string, versionLink: string): Promise<boolean> {
	const res = await vs.window.showInformationMessage(
		`Dart Code has been updated to v${versionDisplay}`,
		`Show Release Notes`,
	);
	if (res) {
		openInBrowser(`https://dartcode.org/releases/v${versionLink}/`);
	}
	return true; // Always mark this as done; we don't want to prompt the user multiple times.
}

function error(err: any) {
	vs.window.showErrorMessage(err.message);
}

function handleNewProjects(context: Context) {
	getDartWorkspaceFolders().forEach((wf) => {
		handleStagehandTrigger(wf, DART_STAGEHAND_PROJECT_TRIGGER_FILE);
		handleStagehandTrigger(wf, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE);
		handleFlutterCreateTrigger(wf);
	});
}

async function handleStagehandTrigger(wf: vs.WorkspaceFolder, triggerFilename: string): Promise<void> {
	const triggerFile = path.join(fsPath(wf.uri), triggerFilename);
	if (fs.existsSync(triggerFile)) {
		const templateJson = fs.readFileSync(triggerFile).toString().trim();
		let template: StagehandTemplate;
		try {
			template = JSON.parse(templateJson);
		} catch (e) {
			vs.window.showErrorMessage("Failed to run Stagehand to create project");
			return;
		}
		fs.unlinkSync(triggerFile);
		const success = await createDartProject(fsPath(wf.uri), template.name);
		if (success) {
			await vs.commands.executeCommand("dart.getPackages", wf.uri);
			handleDartWelcome(wf, template);
		}
	}
}

function handleFlutterCreateTrigger(wf: vs.WorkspaceFolder) {
	const flutterTriggerFile = path.join(fsPath(wf.uri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
	if (fs.existsSync(flutterTriggerFile)) {
		let sampleID = fs.readFileSync(flutterTriggerFile).toString().trim();
		sampleID = sampleID ? sampleID : undefined;
		fs.unlinkSync(flutterTriggerFile);
		createFlutterProject(fsPath(wf.uri), sampleID).then((success) => {
			if (success)
				handleFlutterWelcome(wf, sampleID);
		});
	}
}

async function createDartProject(projectPath: string, templateName: string): Promise<boolean> {
	const code = await vs.commands.executeCommand("_dart.create", projectPath, templateName) as number;
	return code === 0;
}

async function createFlutterProject(projectPath: string, sampleID: string): Promise<boolean> {
	const projectName = sampleID ? "sample" : undefined;
	const code = await vs.commands.executeCommand("_flutter.create", projectPath, projectName, sampleID) as number;
	return code === 0;
}

function handleFlutterWelcome(workspaceFolder: vs.WorkspaceFolder, sampleID: string) {
	const entryFile = path.join(fsPath(workspaceFolder.uri), "lib/main.dart");
	if (fs.existsSync(entryFile))
		vs.commands.executeCommand("vscode.open", vs.Uri.file(entryFile));
	if (sampleID)
		vs.window.showInformationMessage(`${sampleID} sample ready! Connect a device and press F5 to run.`);
	else
		vs.window.showInformationMessage("Your Flutter project is ready! Connect a device and press F5 to start running.");
}

function handleDartWelcome(workspaceFolder: vs.WorkspaceFolder, template: StagehandTemplate) {
	const workspacePath = fsPath(workspaceFolder.uri);
	const projectName = path.basename(workspacePath);
	const entryFile = path.join(workspacePath, template.entrypoint.replace("__projectName__", projectName));
	if (fs.existsSync(entryFile))
		vs.commands.executeCommand("vscode.open", vs.Uri.file(entryFile));
	vs.window.showInformationMessage(`${template.label} project ready!`);
}
