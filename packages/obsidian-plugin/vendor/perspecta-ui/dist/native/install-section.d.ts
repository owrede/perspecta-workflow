export interface InstallSectionSpec<R> {
    /** Info-box title. Defaults to "Agent skills". */
    title?: string;
    /** Info-box body explaining what installation does. */
    body: string;
    /** Setting row name. Defaults to "Agent skills". */
    settingName?: string;
    /** Setting row description (what files are written, safety note). */
    settingDesc: string;
    /** Button label. Defaults to "Install / Update agent skills". */
    buttonLabel?: string;
    /** Button running label. Defaults to "Installing…". */
    runningLabel?: string;
    /** Produce the current status line (e.g. "Installed skills: 2/3."). */
    status: () => Promise<string>;
    /** Perform the install/update; its result is passed to onInstalled. */
    install: () => Promise<R>;
    /** Called after a successful install with the result and refreshed status. */
    onInstalled?: (result: R, status: string) => void;
    /** Called if install throws (after the button is restored). */
    onError?: (err: unknown) => void;
}
/**
 * Render the common Install-tab section shared by every Perspecta plugin:
 * an info box, a live status line, and an async "Install / Update agent skills"
 * button that refreshes the status when it completes.
 *
 * Suite convention (catalog §3.5): plugins expose post-install setup through a
 * settings Install tab. This centralises the info-box + status + async-button
 * pattern so the three plugins do not hand-roll it three different ways.
 */
export declare function renderInstallSection<R>(containerEl: HTMLElement, spec: InstallSectionSpec<R>): void;
