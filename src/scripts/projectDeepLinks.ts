type ProjectDialogController = {
	open: () => void;
	close: () => void;
	isOpen: () => boolean;
};

const PROJECT_PARAM = "proyecto";
const IDENTITY_PATH = "/identidad-visual";
const HISTORY_MARKER = "projectDeepLink";
const controllers = new Map<string, ProjectDialogController>();

const currentProject = () => new URL(window.location.href).searchParams.get(PROJECT_PARAM);

const syncDialogsWithUrl = () => {
	const activeSlug = currentProject();

	controllers.forEach((controller, slug) => {
		if (slug !== activeSlug && controller.isOpen()) controller.close();
	});

	const activeController = activeSlug ? controllers.get(activeSlug) : undefined;
	if (activeController && !activeController.isOpen()) activeController.open();
};

const historyStateWithMarker = () => {
	const currentState = window.history.state;
	const state = currentState && typeof currentState === "object" ? currentState : {};
	return { ...state, [HISTORY_MARKER]: true };
};

const openProject = (slug: string) => {
	const url = new URL(window.location.href);
	url.pathname = IDENTITY_PATH;
	url.searchParams.set(PROJECT_PARAM, slug);
	url.hash = "";

	window.history.pushState(historyStateWithMarker(), "", url);
	syncDialogsWithUrl();
};

const closeProject = (slug: string) => {
	if (currentProject() !== slug) return;

	if (window.history.state?.[HISTORY_MARKER]) {
		window.history.back();
		return;
	}

	const url = new URL(window.location.href);
	url.pathname = IDENTITY_PATH;
	url.searchParams.delete(PROJECT_PARAM);
	url.hash = "";
	window.history.replaceState(window.history.state, "", url);
	syncDialogsWithUrl();
};

export const registerProjectDeepLink = (slug: string, controller: ProjectDialogController) => {
	controllers.set(slug, controller);
	queueMicrotask(syncDialogsWithUrl);

	return {
		openProject: () => openProject(slug),
		closeProject: () => closeProject(slug),
	};
};

window.addEventListener("popstate", syncDialogsWithUrl);
